package fio

import "testing"

func TestTextStatusBandwidthUnitsAndMergedDirections(t *testing.T) {
	parser := NewStreamJSONParser(nil)
	readMatches := statusLineRegex.FindStringSubmatch("  read: IOPS=33.0k, BW=129MiB/s (135MB/s)(258MiB/2002msec)")
	writeMatches := statusLineRegex.FindStringSubmatch("  write: IOPS=12.5k, BW=50.2MiB/s (52.6MB/s)(100MiB/2000msec)")
	if readMatches == nil || writeMatches == nil {
		t.Fatal("status regex did not match standard fio text output")
	}

	read := parser.parseStatusLine(readMatches)
	write := parser.parseStatusLine(writeMatches)
	write.Time = read.Time
	merged := mergeStatusUpdates(read, write)
	point := StatusToStatsDataPoint(merged)

	if point.IOPSRead != 33000 || point.IOPSWrite != 12500 {
		t.Fatalf("IOPS read/write = %.0f/%.0f, want 33000/12500", point.IOPSRead, point.IOPSWrite)
	}
	if point.BWRead != 129 || point.BWWrite < 50.19 || point.BWWrite > 50.21 {
		t.Fatalf("BW read/write = %.2f/%.2f MiB/s, want 129/50.2", point.BWRead, point.BWWrite)
	}
}

func TestStatusToStatsDataPointUsesNormalizedBytes(t *testing.T) {
	point := StatusToStatsDataPoint(&StatusUpdate{
		Time: 10,
		Jobs: []JobStatus{{Read: IOStats{BW: 128 * 1024 * 1024}}},
	})
	if point.BW != 128 {
		t.Fatalf("BW = %.2f MiB/s, want 128", point.BW)
	}
}

func TestRawJSONBandwidthIsNormalizedFromKiB(t *testing.T) {
	status := rawToStatusUpdate(&fioStatusUpdateRaw{
		Timestamp: 1_700_000_000,
		Jobs: []JobStatus{{
			Read:  IOStats{BW: 128 * 1024},
			Write: IOStats{BW: 64 * 1024},
		}},
	})
	point := StatusToStatsDataPoint(status)
	if point.BWRead != 128 || point.BWWrite != 64 || point.BW != 192 {
		t.Fatalf("BW total/read/write = %.2f/%.2f/%.2f MiB/s, want 192/128/64", point.BW, point.BWRead, point.BWWrite)
	}
}
