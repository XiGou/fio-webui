package fio

import (
	"os"
	"strings"
	"testing"
)

func TestWriteTaskJobFileIncludesAllJobsWithoutImplicitBarrier(t *testing.T) {
	t.Parallel()

	config := &FioConfig{
		Global: DefaultGlobalConfig(),
		Jobs: []JobConfig{
			{Name: "reader", Filename: "/tmp/fio-test", RW: RWRandRead, BS: "4k", Size: "1G", NumJobs: 1, IODepth: 16},
			{Name: "writer", Filename: "/tmp/fio-test", RW: RWRandWrite, BS: "4k", Size: "1G", NumJobs: 1, IODepth: 16},
		},
	}

	jobFile, err := writeTaskJobFile(t.TempDir(), 0, config)
	if err != nil {
		t.Fatalf("write task jobfile: %v", err)
	}
	contents, err := os.ReadFile(jobFile)
	if err != nil {
		t.Fatalf("read task jobfile: %v", err)
	}

	got := string(contents)
	for _, section := range []string{"[reader]\n", "[writer]\n"} {
		if !strings.Contains(got, section) {
			t.Fatalf("expected %q in task jobfile, got:\n%s", section, got)
		}
	}
	if strings.Contains(got, "stonewall\n") {
		t.Fatalf("did not expect an implicit stonewall in task jobfile, got:\n%s", got)
	}
}
