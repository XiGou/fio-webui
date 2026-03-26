package fio

import (
	"strings"
	"testing"
)

func TestFioConfigToINI_InsertsStonewallBeforeJobAfterMarkedJob(t *testing.T) {
	t.Parallel()

	cfg := &FioConfig{
		Global: DefaultGlobalConfig(),
		Jobs: []JobConfig{
			{
				Name:           "job-1",
				Filename:       "/tmp/fio-test",
				RW:             RWRandRead,
				BS:             "4k",
				Size:           "1G",
				NumJobs:        1,
				IODepth:        16,
				StonewallAfter: true,
			},
			{
				Name:     "job-2",
				Filename: "/tmp/fio-test",
				RW:       RWRandWrite,
				BS:       "128k",
				Size:     "1G",
				NumJobs:  1,
				IODepth:  32,
			},
		},
	}

	got := cfg.ToINI("", -1)

	if !strings.Contains(got, "[job-2]\nstonewall\n") {
		t.Fatalf("expected stonewall before job-2, got:\n%s", got)
	}
}

func TestFioConfigToINI_EmitsJobExtraOptions(t *testing.T) {
	t.Parallel()

	cfg := &FioConfig{
		Global: DefaultGlobalConfig(),
		Jobs: []JobConfig{
			{
				Name:     "job-1",
				Filename: "/tmp/fio-test",
				RW:       RWRandRead,
				BS:       "4k",
				Size:     "1G",
				NumJobs:  1,
				IODepth:  32,
				ExtraOptions: map[string]any{
					"verify":     "crc32c",
					"direct":     false,
					"directory":  "/mnt/fio",
					"rate_iops":  32000,
					"norandommap": true,
				},
			},
		},
	}

	got := cfg.ToINI("", 0)

	for _, needle := range []string{
		"verify=crc32c\n",
		"direct=0\n",
		"directory=/mnt/fio\n",
		"rate_iops=32000\n",
		"norandommap=1\n",
	} {
		if !strings.Contains(got, needle) {
			t.Fatalf("expected %q in jobfile, got:\n%s", needle, got)
		}
	}
}
