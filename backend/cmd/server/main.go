// Command server is the ShowOrSow Go backend entrypoint. It is the only
// component that writes to the ledger (05 §1): it wires the JSON Ledger API v2
// client, the registry clients, the Neon store, the appOperator token source,
// the users account layer (Luma-style real accounts), the HTTP handlers, and
// the 10s withdrawal watcher.
package main

import (
	"context"
	"log"
	"net/http"
	"os"
	"os/signal"
	"syscall"
	"time"

	"github.com/showorsow/backend/internal/api"
	"github.com/showorsow/backend/internal/appauth"
	"github.com/showorsow/backend/internal/config"
	"github.com/showorsow/backend/internal/ledger"
	"github.com/showorsow/backend/internal/settle"
	"github.com/showorsow/backend/internal/store"
	"github.com/showorsow/backend/internal/users"
)

func main() {
	log.SetFlags(log.LstdFlags | log.LUTC)

	envPath := os.Getenv("ENV_FILE")
	if envPath == "" {
		envPath = ".env"
	}
	cfg, err := config.Load(envPath)
	if err != nil {
		log.Fatalf("config: %v", err)
	}
	if cfg.LedgerJSONAPIURL == "" {
		log.Fatal("LEDGER_JSON_API_URL is required")
	}
	if cfg.NeonDatabaseURL == "" {
		log.Fatal("NEON_DATABASE_URL is required")
	}

	rootCtx, cancel := context.WithCancel(context.Background())
	defer cancel()

	// Store.
	st, err := store.New(rootCtx, cfg.NeonDatabaseURL)
	if err != nil {
		log.Fatalf("store: %v", err)
	}
	defer st.Close()
	pingCtx, pingCancel := context.WithTimeout(rootCtx, 10*time.Second)
	if err := st.Ping(pingCtx); err != nil {
		log.Printf("warning: neon ping failed: %v", err)
	}
	pingCancel()

	// appOperator token source + ledger client. Under the Luma-style
	// real-accounts model the backend holds a ledger token ONLY for appOperator;
	// registered users act unauthenticated on sandbox/LocalNet (per-user DevNet
	// JWTs are a documented MVP limitation, 05 §2).
	httpc := &http.Client{Timeout: 60 * time.Second}
	tok := appauth.New(cfg, httpc)
	lc := ledger.New(cfg.LedgerJSONAPIURL, tok, httpc)
	if sync := os.Getenv("SYNCHRONIZER_ID"); sync != "" {
		lc = lc.WithSynchronizer(sync)
	}

	// Users: account CRUD + signup party allocation (the ledger client is the
	// party allocator; appOperator authorises /v2/parties).
	um := users.New(st.Pool(), lc, cfg.AppOperatorParty)

	// Idempotent demo seeding (SEED_DEMO_USERS): ensure the 4 demo accounts
	// exist, allocating a party per account on first creation (05 §2).
	if cfg.SeedDemoUsers {
		seedCtx, seedCancel := context.WithTimeout(rootCtx, 60*time.Second)
		if err := um.EnsureDemoUsers(seedCtx); err != nil {
			log.Printf("warning: demo seeding failed: %v", err)
		} else {
			log.Printf("demo users ensured (%d accounts)", len(users.DemoAccounts))
		}
		seedCancel()
	}

	// Package qualifier for our own templates (DevNet-reset resilient via the
	// package-name form when SHOWOROSOW_PACKAGE_ID is unset).
	pkg := ledger.PackageQualifier(os.Getenv("SHOWOROSOW_PACKAGE_ID"))

	// API server.
	srv := api.New(cfg, lc, um, st, pkg)

	// Withdrawal watcher (05 §7) — 10s tick, its own goroutine.
	watcher := settle.NewWatcher(srv.SettleDeps())
	go watcher.Run(rootCtx)

	httpSrv := &http.Server{
		Addr:              cfg.ListenAddr,
		Handler:           srv.Routes(),
		ReadHeaderTimeout: 15 * time.Second,
	}

	go func() {
		log.Printf("ShowOrSow backend listening on %s (ledger=%s, sequentialSettle=%v)",
			cfg.ListenAddr, cfg.LedgerJSONAPIURL, cfg.SequentialSettle)
		if err := httpSrv.ListenAndServe(); err != nil && err != http.ErrServerClosed {
			log.Fatalf("http: %v", err)
		}
	}()

	// Graceful shutdown.
	sig := make(chan os.Signal, 1)
	signal.Notify(sig, os.Interrupt, syscall.SIGTERM)
	<-sig
	log.Println("shutting down…")
	cancel()
	shutCtx, shutCancel := context.WithTimeout(context.Background(), 10*time.Second)
	defer shutCancel()
	_ = httpSrv.Shutdown(shutCtx)
}
