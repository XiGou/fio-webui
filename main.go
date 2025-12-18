package main

import (
	"embed"
	"flag"
	"log"

	"github.com/gouxi/fio-webui/internal/server"
)

//go:embed web/templates/* web/static/*
var webFS embed.FS

func main() {
	addr := flag.String("addr", ":8080", "HTTP server address")
	debug := flag.Bool("debug", false, "Enable debug logging")
	flag.Parse()

	srv, err := server.New(*addr, webFS, *debug)
	if err != nil {
		log.Fatalf("Failed to create server: %v", err)
	}

	log.Fatal(srv.Run())
}
