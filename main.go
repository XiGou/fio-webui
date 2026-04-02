package main

import (
	"embed"
	"flag"
	"log"
	"os"
	"os/signal"

	"github.com/gouxi/fio-webui/internal/server"
)

//go:embed web/dist/* web/report-template/*
var webFS embed.FS

func main() {
	addr := flag.String("addr", ":8080", "HTTP server address")
	debug := flag.Bool("debug", false, "Enable debug logging")
	dataDir := flag.String("data", "./data", "Data directory for run history (persistent)")
	flag.Parse()

	srv, err := server.New(*addr, webFS, *debug, *dataDir)
	if err != nil {
		log.Fatalf("Failed to create server: %v", err)
	}

	go func() {
		sig := make(chan os.Signal, 1)
		signal.Notify(sig, os.Interrupt)
		<-sig
		log.Println("Shutting down...")
		srv.Shutdown()
	}()

	if err := srv.Run(); err != nil {
		log.Fatal(err)
	}
}
