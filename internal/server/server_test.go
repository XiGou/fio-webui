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

func TestNewStaticHandlerFallsBackWithoutDist(t *testing.T) {
	t.Parallel()

	handler, err := newStaticHandler(fstest.MapFS{
		"web/report-template/report.html": &fstest.MapFile{Data: []byte("report")},
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
