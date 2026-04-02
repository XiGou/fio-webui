package fio

import (
	"bufio"
	"os/exec"
	"strings"
)

// GetIOEngines returns available FIO IO engines
func GetIOEngines() []string {
	cmd := exec.Command("fio", "--enghelp")
	output, err := cmd.Output()
	if err != nil {
		return []string{"libaio", "io_uring", "sync", "posixaio"}
	}

	var engines []string
	scanner := bufio.NewScanner(strings.NewReader(string(output)))
	foundList := false

	for scanner.Scan() {
		line := strings.TrimSpace(scanner.Text())
		if strings.Contains(line, "Available IO engines:") {
			foundList = true
			continue
		}
		if foundList && line != "" && !strings.HasPrefix(line, "Available") {
			engines = append(engines, line)
		}
	}

	if len(engines) == 0 {
		return []string{"libaio", "io_uring", "sync", "posixaio"}
	}

	return engines
}

// GetRWTypes returns available FIO read/write types
func GetRWTypes() []string {
	cmd := exec.Command("fio", "--cmdhelp=rw")
	output, err := cmd.Output()
	if err != nil {
		return []string{"read", "write", "randread", "randwrite", "randrw", "readwrite"}
	}

	var rwTypes []string
	scanner := bufio.NewScanner(strings.NewReader(string(output)))
	inValidValues := false

	for scanner.Scan() {
		line := scanner.Text()
		if strings.Contains(line, "valid values:") {
			inValidValues = true
			continue
		}
		if inValidValues && strings.Contains(line, ":") {
			parts := strings.Split(line, ":")
			if len(parts) >= 2 {
				rwType := strings.TrimSpace(parts[0])
				if rwType != "" {
					rwTypes = append(rwTypes, rwType)
				}
			}
		}
	}

	if len(rwTypes) == 0 {
		return []string{"read", "write", "randread", "randwrite", "randrw", "readwrite"}
	}

	return rwTypes
}

// GetBlockDevices returns list of block devices from lsblk
func GetBlockDevices() []string {
	cmd := exec.Command("lsblk", "-l")
	output, err := cmd.Output()
	if err != nil {
		return []string{}
	}

	var devices []string
	scanner := bufio.NewScanner(strings.NewReader(string(output)))
	first := true

	for scanner.Scan() {
		if first {
			first = false
			continue
		}
		line := strings.Fields(scanner.Text())
		if len(line) > 0 {
			devices = append(devices, "/dev/"+line[0])
		}
	}

	return devices
}
