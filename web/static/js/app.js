const App = {
    charts: {},
    visibleCharts: { bw: true, iops: true, lat: true, p99: true },
    data: {
        bw: { read: [[], []], write: [[], []] },
        iops: { read: [[], []], write: [[], []] },
        lat: { read: [[], []], write: [[], []] },
        p99: { read: [[], []], write: [[], []] }
    },
    jobs: [],
    eventSource: null,
    maxPoints: 300,

    async init() {
        await this.loadOptions();
        this.bindEvents();
        this.initCharts();
        this.connectWebSocket();
        this.updateRWMixVisibility();
        this.setupConfigToggle();
        this.setupChartToggles();
    },

    async loadOptions() {
        try {
            const resp = await fetch('/api/options');
            if (!resp.ok) return;
            const options = await resp.json();

            // Update IO Engines
            const ioEngineSelect = document.getElementById('ioengine');
            const currentEngine = ioEngineSelect.value;
            ioEngineSelect.innerHTML = '';
            options.io_engines.forEach(engine => {
                const option = document.createElement('option');
                option.value = engine;
                option.textContent = engine;
                if (engine === currentEngine) option.selected = true;
                ioEngineSelect.appendChild(option);
            });

            // Update RW Types
            const rwSelect = document.getElementById('rw');
            const currentRW = rwSelect.value;
            rwSelect.innerHTML = '';
            options.rw_types.forEach(rwType => {
                const option = document.createElement('option');
                option.value = rwType;
                option.textContent = rwType;
                if (rwType === currentRW) option.selected = true;
                rwSelect.appendChild(option);
            });

            // Update Device list for filename
            const devicesList = document.getElementById('devices-list');
            devicesList.innerHTML = '';
            options.devices.forEach(device => {
                const option = document.createElement('option');
                option.value = device;
                devicesList.appendChild(option);
            });
        } catch (e) {
            console.error('Failed to load options:', e);
        }
    },

    setupConfigToggle() {
        const heading = document.querySelector('.config-panel h2');
        const content = document.querySelector('.config-content');
        const toggle = document.querySelector('.config-toggle');

        heading.addEventListener('click', () => {
            content.classList.toggle('collapsed');
            toggle.classList.toggle('collapsed');
        });
    },

    setupChartToggles() {
        document.querySelectorAll('.chart-toggle').forEach(btn => {
            btn.addEventListener('click', () => {
                const chart = btn.dataset.chart;
                btn.classList.toggle('active');
                this.visibleCharts[chart] = btn.classList.contains('active');
                document.getElementById(`chart-${chart}-container`).classList.toggle('hidden');
            });
        });
    },

    bindEvents() {
        document.getElementById('btn-start').addEventListener('click', () => this.startTest());
        document.getElementById('btn-stop').addEventListener('click', () => this.stopTest());
        document.getElementById('rw').addEventListener('change', () => this.updateRWMixVisibility());
    },

    updateRWMixVisibility() {
        const rw = document.getElementById('rw').value;
        const group = document.getElementById('rwmixread-group');
        if (rw === 'randrw' || rw === 'readwrite' || rw === 'rw' || rw === 'trimwrite' || rw === 'randtrimwrite') {
            group.classList.add('visible');
        } else {
            group.classList.remove('visible');
        }
    },

    addJob() {
        const jobConfig = this.getCurrentJobConfig();
        this.jobs.push(jobConfig);
        this.renderJobsList();
        this.log(`Added job: ${jobConfig.name || 'Unnamed'}`);
    },

    removeJob(index) {
        const removed = this.jobs.splice(index, 1);
        this.renderJobsList();
        this.log(`Removed job: ${removed[0].name || 'Unnamed'}`);
    },

    toggleJobDetails(index) {
        const details = document.getElementById(`job-${index}-details`);
        const toggle = document.getElementById(`job-${index}-toggle`);
        details.classList.toggle('collapsed');
        toggle.classList.toggle('collapsed');
    },

    renderJobsList() {
        const list = document.getElementById('jobs-list');
        list.innerHTML = '';

        this.jobs.forEach((job, index) => {
            const jobEl = document.createElement('div');
            jobEl.className = 'job-item';

            jobEl.innerHTML = `
                <div class="job-item-header" onclick="App.toggleJobDetails(${index})">
                    <span class="job-item-name">${job.name || `Job ${index + 1}`}</span>
                    <span class="job-item-toggle" id="job-${index}-toggle">▶</span>
                </div>
                <div class="job-item-details collapsed" id="job-${index}-details">
                    <div class="job-detail-group">
                        <label>Filename</label>
                        <value>${job.filename}</value>
                    </div>
                    <div class="job-detail-group">
                        <label>RW Type</label>
                        <value>${job.rw}</value>
                    </div>
                    <div class="job-detail-group">
                        <label>Block Size</label>
                        <value>${job.bs}</value>
                    </div>
                    <div class="job-detail-group">
                        <label>Test Size</label>
                        <value>${job.size}</value>
                    </div>
                    <div class="job-detail-group">
                        <label>Number of Jobs</label>
                        <value>${job.numjobs}</value>
                    </div>
                    <div class="job-detail-group">
                        <label>IO Depth</label>
                        <value>${job.iodepth}</value>
                    </div>
                    ${job.rw === 'randrw' || job.rw === 'readwrite' || job.rw === 'rw' ? `
                    <div class="job-detail-group">
                        <label>Read %</label>
                        <value>${job.rwmixread}%</value>
                    </div>
                    ` : ''}
                    ${job.rate ? `
                    <div class="job-detail-group">
                        <label>Rate</label>
                        <value>${job.rate}</value>
                    </div>
                    ` : ''}
                </div>
                <div style="padding: 8px 12px; border-top: 1px solid var(--border); display: flex; gap: 8px;">
                    <button class="btn-small remove" onclick="App.removeJob(${index})">Remove</button>
                </div>
            `;
            list.appendChild(jobEl);
        });
    },

    getCurrentJobConfig() {
        return {
            name: document.getElementById('jobname').value,
            filename: document.getElementById('filename').value,
            rw: document.getElementById('rw').value,
            bs: document.getElementById('bs').value,
            size: document.getElementById('size').value,
            numjobs: parseInt(document.getElementById('numjobs').value),
            iodepth: parseInt(document.getElementById('iodepth').value),
            rwmixread: parseInt(document.getElementById('rwmixread').value) || 0,
            rate: document.getElementById('rate').value || ''
        };
    },

    getConfig() {
        const jobs = [this.getCurrentJobConfig(), ...this.jobs];

        return {
            global: {
                ioengine: document.getElementById('ioengine').value,
                direct: document.getElementById('direct').checked,
                runtime: parseInt(document.getElementById('runtime').value),
                time_based: true,
                group_reporting: true,
                log_avg_msec: parseInt(document.getElementById('log_avg_msec').value),
                output_format: 'json',   // JSON format for status updates
                status_interval: 1       // 1 second status updates for real-time JSON parsing
            },
            jobs: jobs
        };
    },

    async startTest() {
        this.clearData();
        const config = this.getConfig();

        if (config.jobs.length === 0) {
            this.log('Error: No jobs configured');
            return;
        }

        try {
            const resp = await fetch('/api/run', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(config)
            });

            if (!resp.ok) {
                const err = await resp.json();
                this.log('Error: ' + (err.error || 'Failed to start test'));
                return;
            }

            this.log('Test started...');
        } catch (e) {
            this.log('Request failed: ' + e.message);
        }
    },

    async stopTest() {
        try {
            await fetch('/api/stop', { method: 'POST' });
            this.log('Sending Ctrl+C to stop test...');
        } catch (e) {
            this.log('Stop failed: ' + e.message);
        }
    },

    connectWebSocket() {
        const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
        const wsUrl = `${protocol}//${window.location.host}/api/events`;

        console.log('Connecting to WebSocket:', wsUrl);

        this.ws = new WebSocket(wsUrl);

        this.ws.onopen = () => {
            console.log('WebSocket connected');
        };

        this.ws.onmessage = (e) => {
            const msg = JSON.parse(e.data);
            this.handleMessage(msg);
        };

        this.ws.onerror = (error) => {
            console.error('WebSocket error:', error);
        };

        this.ws.onclose = () => {
            console.log('WebSocket disconnected, reconnecting in 3s...');
            setTimeout(() => this.connectWebSocket(), 3000);
        };
    },

    handleMessage(msg) {
        switch (msg.type) {
            case 'status':
                this.updateStatus(msg.data);
                break;
            case 'stats':
                this.handleStats(msg.data);
                break;
            case 'output':
                this.handleOutput(msg.data);
                break;
        }
    },

    updateStatus(state) {
        const indicator = document.getElementById('status-indicator');
        const statusText = {
            idle: 'Idle',
            running: 'Running',
            finished: 'Finished',
            error: 'Error'
        };

        indicator.textContent = statusText[state.status] || state.status;
        indicator.className = 'status ' + state.status;

        document.getElementById('btn-start').disabled = state.status === 'running';
        document.getElementById('btn-stop').disabled = state.status !== 'running';

        if (state.status === 'finished' || state.status === 'error') {
            if (state.output) {
                this.log('\n--- FIO Output ---\n' + state.output);
            }
            if (state.error) {
                this.log('Error: ' + state.error);
            }
        }
    },

    handleOutput(data) {
        if (data.line) {
            this.log(data.line);
        }
    },

    handleStats(stats) {
        // stats is a FioStatsIncrement object with: time, duration_sec, iops, iops_read, iops_write, bw, bw_read, bw_write, lat_mean, lat_p99, lat_p99_9

        // Map stats to our data structure
        // Assuming we want to track: bw, iops, lat, p99
        const timeSeconds = stats.time / 1000;

        // Add to bw data (use average of read and write)
        const bwRead = stats.bw_read || 0;
        const bwWrite = stats.bw_write || 0;
        this.data.bw.read[0].push(timeSeconds);
        this.data.bw.read[1].push(bwRead);
        this.data.bw.write[0].push(timeSeconds);
        this.data.bw.write[1].push(bwWrite);

        // Add to iops data
        const iopsRead = stats.iops_read || 0;
        const iopsWrite = stats.iops_write || 0;
        this.data.iops.read[0].push(timeSeconds);
        this.data.iops.read[1].push(iopsRead);
        this.data.iops.write[0].push(timeSeconds);
        this.data.iops.write[1].push(iopsWrite);

        // Add to latency data
        const latMean = stats.lat_mean || 0;
        const latP99 = stats.lat_p99 || 0;
        this.data.lat.read[0].push(timeSeconds);
        this.data.lat.read[1].push(latMean / 1000); // Convert to milliseconds for display
        this.data.p99.read[0].push(timeSeconds);
        this.data.p99.read[1].push(latP99 / 1000);

        // Keep only maxPoints
        for (const type of ['bw', 'iops', 'lat', 'p99']) {
            for (const dir of ['read', 'write']) {
                const timeData = this.data[type][dir][0];
                const valueData = this.data[type][dir][1];
                if (timeData.length > this.maxPoints) {
                    timeData.shift();
                    valueData.shift();
                }
            }
        }

        // Update all charts
        this.updateChart('bw');
        this.updateChart('iops');
        this.updateChart('lat');
        this.updateChart('p99');

        console.log(`[STATS] Time: ${timeSeconds.toFixed(1)}s, IOPS: ${(iopsRead + iopsWrite).toFixed(0)}, BW: ${(bwRead + bwWrite).toFixed(0)} KiB/s, Lat: ${latMean.toFixed(0)} μs, P99: ${latP99.toFixed(0)} μs`);
    },

    handleLogData(logData) {
        const typeMap = {
            bw: 'bw',
            iops: 'iops',
            clat: 'lat',
            lat: 'lat',
            slat: 'lat',
            p99: 'p99',
            p95: 'p99',
            p90: 'p99'
        };
        const dataType = typeMap[logData.type] || logData.type;

        console.log(`[LOG] Type: ${logData.type} -> ${dataType}, Entries: ${logData.entries?.length || 0}`);

        if (!this.data[dataType]) {
            console.warn(`[LOG] Unknown data type: ${dataType}`);
            return;
        }

        for (const entry of logData.entries) {
            const key = entry.direction === 0 ? 'read' : 'write';
            const timeData = this.data[dataType][key][0];
            const valueData = this.data[dataType][key][1];

            let value = entry.value;
            if (dataType === 'lat') {
                value = value / 1000;
            }

            timeData.push(entry.time / 1000);
            valueData.push(value);

            if (timeData.length > this.maxPoints) {
                timeData.shift();
                valueData.shift();
            }
        }

        this.updateChart(dataType);
    },

    initCharts() {
        const opts = (yLabel) => ({
            width: 600,
            height: 250,
            series: [
                {},
                { stroke: '#22c55e', width: 2, label: 'Read' },
                { stroke: '#f59e0b', width: 2, label: 'Write' }
            ],
            scales: {
                x: { time: false },
                y: { auto: true }
            },
            axes: [
                { stroke: '#999', grid: { stroke: '#e5e5e5' } },
                { stroke: '#999', grid: { stroke: '#e5e5e5' }, label: yLabel }
            ],
            cursor: { show: true },
            legend: { show: true }
        });

        this.charts.bw = new uPlot(
            opts('KiB/s'),
            [[0], [0], [0]],
            document.getElementById('chart-bw')
        );

        this.charts.iops = new uPlot(
            opts('ops/s'),
            [[0], [0], [0]],
            document.getElementById('chart-iops')
        );

        this.charts.lat = new uPlot(
            opts('μs'),
            [[0], [0], [0]],
            document.getElementById('chart-lat')
        );

        this.charts.p99 = new uPlot(
            opts('μs'),
            [[0], [0], [0]],
            document.getElementById('chart-p99')
        );
    },

    updateChart(type) {
        const chart = this.charts[type];
        if (!chart) {
            console.warn(`[CHART] Chart ${type} not initialized`);
            return;
        }

        if (!this.visibleCharts[type]) {
            console.log(`[CHART] Chart ${type} is hidden`);
            return;
        }

        const readData = this.data[type].read;
        const writeData = this.data[type].write;

        // Create time-indexed maps for O(1) lookup instead of indexOf
        const readMap = new Map();
        const writeMap = new Map();

        for (let i = 0; i < readData[0].length; i++) {
            readMap.set(readData[0][i], readData[1][i]);
        }
        for (let i = 0; i < writeData[0].length; i++) {
            writeMap.set(writeData[0][i], writeData[1][i]);
        }

        const times = [...new Set([...readData[0], ...writeData[0]])].sort((a, b) => a - b);

        const readValues = times.map(t => readMap.get(t) ?? null);
        const writeValues = times.map(t => writeMap.get(t) ?? null);

        if (times.length > 0) {
            console.log(`[CHART] Updating chart ${type} with ${times.length} time points`);
            chart.setData([times, readValues, writeValues]);
        }
    },

    clearData() {
        for (const type of ['bw', 'iops', 'lat', 'p99']) {
            this.data[type] = { read: [[], []], write: [[], []] };
            if (this.charts[type]) {
                this.charts[type].setData([[0], [0], [0]]);
            }
        }
        document.getElementById('output').textContent = '';
    },

    log(msg) {
        const output = document.getElementById('output');
        const maxLines = 100;

        // Handle ANSI clear screen
        if (msg.includes('\033[2J') || msg.includes('\033[H')) {
            output.innerHTML = '';
        }

        // Convert ANSI codes to HTML
        const htmlMsg = this.ansiToHtml(msg);
        const line = document.createElement('div');
        line.innerHTML = htmlMsg;
        output.appendChild(line);

        // Keep only last maxLines lines
        while (output.children.length > maxLines) {
            output.removeChild(output.firstChild);
        }

        output.scrollTop = output.scrollHeight;
    },

    ansiToHtml(text) {
        const ansiColorMap = {
            '0': '', '30': 'black', '31': 'red', '32': 'green', '33': 'yellow',
            '34': 'blue', '35': 'magenta', '36': 'cyan', '37': 'white',
            '90': 'bright-black', '91': 'bright-red', '92': 'bright-green', '93': 'bright-yellow',
            '94': 'bright-blue', '95': 'bright-magenta', '96': 'bright-cyan', '97': 'bright-white'
        };

        const ansiBackgroundMap = {
            '40': 'black', '41': 'red', '42': 'green', '43': 'yellow',
            '44': 'blue', '45': 'magenta', '46': 'cyan', '47': 'white',
            '100': 'bright-black', '101': 'bright-red', '102': 'bright-green', '103': 'bright-yellow',
            '104': 'bright-blue', '105': 'bright-magenta', '106': 'bright-cyan', '107': 'bright-white'
        };

        let html = '';
        let currentSpan = null;
        let classes = '';

        // Remove clear codes for processing
        text = text.replace(/\033\[2J/g, '').replace(/\033\[H/g, '');

        // Split by ANSI escape sequences
        const parts = text.split(/(\033\[[0-9;]*m)/);

        for (const part of parts) {
            if (part.match(/\033\[[\d;]*m/)) {
                // This is an ANSI control sequence
                const codes = part.match(/\033\[([0-9;]*)m/)[1].split(';');
                classes = '';

                for (const code of codes) {
                    if (code === '' || code === '0') {
                        classes = '';
                    } else if (ansiColorMap[code]) {
                        classes += (classes ? ' ' : '') + 'ansi-' + ansiColorMap[code];
                    } else if (ansiBackgroundMap[code]) {
                        classes += (classes ? ' ' : '') + 'ansi-bg-' + ansiBackgroundMap[code];
                    }
                }

                if (classes) {
                    currentSpan = classes;
                } else {
                    currentSpan = null;
                }
            } else if (part) {
                // Regular text
                const escaped = part
                    .replace(/&/g, '&amp;')
                    .replace(/</g, '&lt;')
                    .replace(/>/g, '&gt;')
                    .replace(/"/g, '&quot;')
                    .replace(/'/g, '&#39;');

                if (currentSpan) {
                    html += `<span class="${currentSpan}">${escaped}</span>`;
                } else {
                    html += escaped;
                }
            }
        }

        return html;
    }
};

document.addEventListener('DOMContentLoaded', () => App.init());
