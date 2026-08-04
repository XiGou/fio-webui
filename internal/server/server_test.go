package server

import (
	"io/fs"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
	"testing/fstest"
)

func TestNewStaticHandlerServesEmbeddedDist(t *testing.T) {
	t.Parallel()

	handler, err := newStaticHandler(fstest.MapFS{
		"web/dist/index.html": &fstest.MapFile{Data: []byte("ok")},
	})
	if err != nil {
		t.Fatalf("newStaticHandler() error = %v", err)
	}

	req := httptest.NewRequest(http.MethodGet, "/", nil)
	rec := httptest.NewRecorder()
	handler.ServeHTTP(rec, req)

	if rec.Code != http.StatusOK {
		t.Fatalf("status = %d, want %d", rec.Code, http.StatusOK)
	}
	if body := rec.Body.String(); body != "ok" {
		t.Fatalf("body = %q, want %q", body, "ok")
	}
}

func TestNewStaticHandlerServesIndexForClientRoute(t *testing.T) {
	t.Parallel()

	handler, err := newStaticHandler(fstest.MapFS{
		"web/dist/index.html": &fstest.MapFile{Data: []byte("app shell")},
	})
	if err != nil {
		t.Fatalf("newStaticHandler() error = %v", err)
	}

	req := httptest.NewRequest(http.MethodGet, "/monitor?runId=run-1", nil)
	rec := httptest.NewRecorder()
	handler.ServeHTTP(rec, req)

	if rec.Code != http.StatusOK {
		t.Fatalf("status = %d, want %d", rec.Code, http.StatusOK)
	}
	if body := rec.Body.String(); body != "app shell" {
		t.Fatalf("body = %q, want %q", body, "app shell")
	}
}

func TestNewStaticHandlerFallsBackWithoutDist(t *testing.T) {
	t.Parallel()

	handler, err := newStaticHandler(fstest.MapFS{
		"web/report-template/report.html":              &fstest.MapFile{Data: []byte("report")},
		"web/report-template/vendor/uPlot.iife.min.js": &fstest.MapFile{Data: []byte("uplot-js")},
		"web/report-template/vendor/uPlot.min.css":     &fstest.MapFile{Data: []byte("uplot-css")},
	})
	if err != nil {
		t.Fatalf("newStaticHandler() error = %v", err)
	}

	req := httptest.NewRequest(http.MethodGet, "/", nil)
	rec := httptest.NewRecorder()
	handler.ServeHTTP(rec, req)

	if rec.Code != http.StatusOK {
		t.Fatalf("status = %d, want %d", rec.Code, http.StatusOK)
	}
	if body := rec.Body.String(); !strings.Contains(body, "Frontend assets are not built") {
		t.Fatalf("body %q does not contain fallback message", body)
	}
}

func TestNewStaticHandlerReturnsUnexpectedSubErrors(t *testing.T) {
	t.Parallel()

	brokenFS := errFS{}

	_, err := newStaticHandler(brokenFS)
	if err == nil {
		t.Fatal("newStaticHandler() error = nil, want non-nil")
	}
}

type errFS struct{}

func (errFS) Open(string) (fs.File, error) {
	return nil, fs.ErrPermission
}
