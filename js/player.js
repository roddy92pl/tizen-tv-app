/**
 * player.js – Video Player wrapper
 * Supports: Samsung Tizen AVPlay API (primary), HTML5 Video (fallback)
 * Handles: play/pause/stop/seek, progress updates, remote controls.
 */
const Player = (() => {
    const KEY = Navigation ? Navigation.KEY : {};

    let _useAVPlay   = false;
    let _avPlayer    = null;
    let _videoEl     = null;
    let _overlayEl   = null;
    let _overlayTimer = null;
    let _progressTimer = null;
    let _currentMeta = {};
    let _isLive      = false;
    let _isPlaying   = false;
    let _callbacks   = {};
    let _hideDelay   = 4000;

    /* -------- DOM refs -------- */
    const els = () => ({
        avPlayer:   document.getElementById('av-player'),
        videoEl:    document.getElementById('html5-player'),
        overlay:    document.getElementById('player-overlay'),
        btnPlay:    document.getElementById('player-btn-play'),
        btnStop:    document.getElementById('player-btn-stop'),
        btnFF:      document.getElementById('player-btn-ff'),
        btnRW:      document.getElementById('player-btn-rw'),
        btnBack:    document.getElementById('player-btn-back'),
        progress:   document.getElementById('player-progress'),
        buffer:     document.getElementById('player-buffer'),
        progressBar:document.getElementById('player-progress-bar'),
        position:   document.getElementById('player-position'),
        title:      document.getElementById('player-title'),
        subtitle:   document.getElementById('player-subtitle'),
        logo:       document.getElementById('player-channel-logo'),
        timeEl:     document.getElementById('player-time'),
        epgOverlay: document.getElementById('epg-overlay'),
        epgCurTime: document.getElementById('epg-current-time'),
        epgCurTitle:document.getElementById('epg-current-title'),
        epgNextTime:document.getElementById('epg-next-time'),
        epgNextTitle:document.getElementById('epg-next-title'),
        epgProgress:document.getElementById('epg-progress')
    });

    /* -------- Init -------- */
    function init() {
        _videoEl  = document.getElementById('html5-player');
        _avPlayer = document.getElementById('av-player');
        _overlayEl = document.getElementById('player-overlay');

        // Detect AVPlay
        try {
            _useAVPlay = !!(window.webapis && webapis.avplay);
        } catch (e) {
            _useAVPlay = false;
        }

        _bindVideoEvents();
        _bindControls();
        _startClockUpdate();
    }

    function _bindVideoEvents() {
        if (!_videoEl) return;
        _videoEl.addEventListener('play',     () => { _isPlaying = true;  _updatePlayBtn(); });
        _videoEl.addEventListener('pause',    () => { _isPlaying = false; _updatePlayBtn(); });
        _videoEl.addEventListener('ended',    () => { _isPlaying = false; _updatePlayBtn(); if (_callbacks.ended) _callbacks.ended(); });
        _videoEl.addEventListener('error',    (e) => { if (_callbacks.error) _callbacks.error(e); });
        _videoEl.addEventListener('waiting',  () => { /* buffering */ });
        _videoEl.addEventListener('canplay',  () => { /* ready */ });
        _videoEl.addEventListener('timeupdate', _onTimeUpdate);
        _videoEl.addEventListener('progress',   _onBufferUpdate);
    }

    function _bindControls() {
        const e = els();
        if (e.btnPlay)  e.btnPlay.addEventListener('click',  togglePlay);
        if (e.btnStop)  e.btnStop.addEventListener('click',  stop);
        if (e.btnFF)    e.btnFF.addEventListener('click',    () => seek(30));
        if (e.btnRW)    e.btnRW.addEventListener('click',    () => seek(-30));
        if (e.btnBack)  e.btnBack.addEventListener('click',  () => { if (_callbacks.back) _callbacks.back(); });

        // Show overlay on any interaction in the player
        const playerPage = document.getElementById('page-player');
        if (playerPage) {
            playerPage.addEventListener('click', showOverlay);
        }
    }

    function _startClockUpdate() {
        setInterval(() => {
            const t = els().timeEl;
            if (t) {
                const now = new Date();
                t.textContent = now.toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit', hour12: false });
            }
        }, 1000);
    }

    /* -------- Playback -------- */

    /**
     * Validate a stream URL so that only http:// and https:// origins are
     * ever assigned to media elements, preventing javascript: URI injection.
     * Returns the normalised href, or an empty string for invalid inputs.
     */
    function _sanitizeUrl(url) {
        if (typeof url !== 'string' || !url) return '';
        try {
            const parsed = new URL(url);
            return (parsed.protocol === 'http:' || parsed.protocol === 'https:')
                ? parsed.href
                : '';
        } catch (e) {
            return '';
        }
    }

    function play(url, type, meta, savedPosition) {
        _isLive      = type === 'live';
        _currentMeta = meta || {};

        _updateInfo(meta);
        _toggleVODControls(!_isLive);

        const e = els();

        if (_useAVPlay) {
            _playAVPlay(url, type, savedPosition);
        } else {
            _playHTML5(url, savedPosition);
        }

        showOverlay();
    }

    function _playHTML5(url, savedPosition) {
        const v = document.getElementById('html5-player');
        if (!v) return;
        const safeUrl = _sanitizeUrl(url);
        if (!safeUrl) { if (_callbacks.error) _callbacks.error(new Error('Invalid stream URL')); return; }
        v.src = safeUrl;
        v.load();
        const playPromise = v.play();
        if (playPromise !== undefined) {
            playPromise
                .then(() => {
                    _isPlaying = true;
                    _updatePlayBtn();
                    if (savedPosition && savedPosition > 5) {
                        v.currentTime = savedPosition;
                    }
                })
                .catch(err => {
                    if (_callbacks.error) _callbacks.error(err);
                });
        }
    }

    function _playAVPlay(url, type, savedPosition) {
        try {
            const safeUrl = _sanitizeUrl(url);
            if (!safeUrl) { if (_callbacks.error) _callbacks.error(new Error('Invalid stream URL')); return; }
            webapis.avplay.open(safeUrl);
            webapis.avplay.setDisplayRect(0, 0, 1920, 1080);
            webapis.avplay.setListener({
                onbufferingstart: () => {},
                onbufferingprogress: () => {},
                onbufferingcomplete: () => {
                    _isPlaying = true;
                    _updatePlayBtn();
                    if (savedPosition && savedPosition > 5 && type !== 'live') {
                        try { webapis.avplay.seekTo(savedPosition * 1000); } catch (e) {}
                    }
                },
                oncurrentplaytime: (time) => {
                    _updateAVPlayProgress(time);
                },
                onevent: (eventType) => {},
                onerror: (eventType) => {
                    if (_callbacks.error) _callbacks.error(new Error(eventType));
                },
                ondrmevent: () => {},
                onstreamcompleted: () => {
                    _isPlaying = false;
                    _updatePlayBtn();
                    if (_callbacks.ended) _callbacks.ended();
                }
            });
            webapis.avplay.prepareAsync(() => {
                webapis.avplay.play();
            }, (err) => {
                if (_callbacks.error) _callbacks.error(new Error(err));
                // Fallback to HTML5
                _useAVPlay = false;
                _playHTML5(url, savedPosition);
            });
        } catch (err) {
            _useAVPlay = false;
            _playHTML5(url, savedPosition);
        }
    }

    function pause() {
        if (_useAVPlay) {
            try { webapis.avplay.pause(); } catch (e) {}
        } else {
            const v = document.getElementById('html5-player');
            if (v) v.pause();
        }
        _isPlaying = false;
        _updatePlayBtn();
    }

    function resume() {
        if (_useAVPlay) {
            try { webapis.avplay.play(); } catch (e) {}
        } else {
            const v = document.getElementById('html5-player');
            if (v) v.play().catch(() => {});
        }
        _isPlaying = true;
        _updatePlayBtn();
    }

    function togglePlay() {
        if (_isPlaying) pause(); else resume();
    }

    function stop() {
        clearInterval(_progressTimer);
        if (_useAVPlay) {
            try { webapis.avplay.stop(); webapis.avplay.close(); } catch (e) {}
        } else {
            const v = document.getElementById('html5-player');
            if (v) { v.pause(); v.src = ''; }
        }
        _isPlaying = false;
        _updatePlayBtn();
        hideOverlay();
        if (_callbacks.stop) _callbacks.stop();
    }

    function seek(seconds) {
        if (_isLive) return;
        const v = document.getElementById('html5-player');
        if (_useAVPlay) {
            try {
                const cur = webapis.avplay.getCurrentTime();
                webapis.avplay.seekTo(Math.max(0, cur + seconds * 1000));
            } catch (e) {}
        } else if (v) {
            v.currentTime = Math.max(0, v.currentTime + seconds);
        }
        showOverlay();
    }

    function seekToPercent(pct) {
        if (_isLive) return;
        const v = document.getElementById('html5-player');
        if (_useAVPlay) {
            try {
                const dur = webapis.avplay.getDuration();
                webapis.avplay.seekTo(dur * pct / 100);
            } catch (e) {}
        } else if (v && v.duration) {
            v.currentTime = v.duration * pct / 100;
        }
    }

    function getCurrentPosition() {
        if (_useAVPlay) {
            try { return webapis.avplay.getCurrentTime() / 1000; } catch (e) { return 0; }
        } else {
            const v = document.getElementById('html5-player');
            return v ? v.currentTime : 0;
        }
    }

    function getDuration() {
        if (_useAVPlay) {
            try { return webapis.avplay.getDuration() / 1000; } catch (e) { return 0; }
        } else {
            const v = document.getElementById('html5-player');
            return v ? (v.duration || 0) : 0;
        }
    }

    /* -------- Progress -------- */
    function _onTimeUpdate() {
        const v = document.getElementById('html5-player');
        if (!v) return;
        const e = els();
        const cur = v.currentTime, dur = v.duration;
        if (!dur) return;
        const pct = (cur / dur) * 100;
        if (e.progress)  e.progress.style.width  = pct + '%';
        if (e.position)  e.position.textContent   = _formatTime(cur) + ' / ' + _formatTime(dur);
        if (_callbacks.progress) _callbacks.progress(cur, dur);
        // Auto-save position
        if (_currentMeta && _currentMeta.id) {
            Storage.savePosition(_currentMeta.id, cur, dur);
        }
    }

    function _onBufferUpdate() {
        const v = document.getElementById('html5-player');
        if (!v || !v.duration) return;
        const e = els();
        if (v.buffered.length > 0) {
            const buffPct = (v.buffered.end(v.buffered.length - 1) / v.duration) * 100;
            if (e.buffer) e.buffer.style.width = buffPct + '%';
        }
    }

    function _updateAVPlayProgress(timeMs) {
        const e = els();
        let dur = 0;
        try { dur = webapis.avplay.getDuration() / 1000; } catch (ex) {}
        const cur = timeMs / 1000;
        if (dur > 0) {
            const pct = (cur / dur) * 100;
            if (e.progress) e.progress.style.width = pct + '%';
            if (e.position) e.position.textContent  = _formatTime(cur) + ' / ' + _formatTime(dur);
            if (_callbacks.progress) _callbacks.progress(cur, dur);
            if (_currentMeta && _currentMeta.id) {
                Storage.savePosition(_currentMeta.id, cur, dur);
            }
        }
    }

    function _formatTime(seconds) {
        if (!isFinite(seconds) || seconds < 0) return '0:00';
        const h = Math.floor(seconds / 3600);
        const m = Math.floor((seconds % 3600) / 60);
        const s = Math.floor(seconds % 60);
        if (h > 0) return `${h}:${String(m).padStart(2,'0')}:${String(s).padStart(2,'0')}`;
        return `${m}:${String(s).padStart(2,'0')}`;
    }

    /* -------- UI helpers -------- */
    function _updatePlayBtn() {
        const btn = document.getElementById('player-btn-play');
        if (btn) btn.textContent = _isPlaying ? '⏸' : '▶';
    }

    function _toggleVODControls(show) {
        const e = els();
        const display = show ? '' : 'none';
        if (e.btnFF)      e.btnFF.style.display      = display;
        if (e.btnRW)      e.btnRW.style.display      = display;
        if (e.position)   e.position.style.display   = display;
        if (e.progressBar) e.progressBar.style.display = display;
    }

    function _updateInfo(meta) {
        if (!meta) return;
        const e = els();
        if (e.title)    e.title.textContent    = meta.title    || '';
        if (e.subtitle) e.subtitle.textContent = meta.subtitle || '';
        if (e.logo) {
            e.logo.src = meta.logo || '';
            e.logo.style.display = meta.logo ? '' : 'none';
        }
    }

    function showOverlay() {
        if (_overlayEl) _overlayEl.classList.remove('hidden');
        _resetHideTimer();
        Navigation.setFocusTo(document.getElementById('player-btn-play'));
    }

    function hideOverlay() {
        if (_overlayEl) _overlayEl.classList.add('hidden');
        clearTimeout(_overlayTimer);
    }

    function _resetHideTimer() {
        clearTimeout(_overlayTimer);
        _overlayTimer = setTimeout(hideOverlay, _hideDelay);
    }

    function showEPG(epgData) {
        const e = els();
        if (!e.epgOverlay || !epgData) return;
        const programs = epgData.epg_listings || [];
        if (!programs.length) return;

        const now = Date.now() / 1000;
        const current = programs.find(p => p.start_timestamp <= now && p.stop_timestamp > now);
        const next    = programs.find(p => p.start_timestamp > now);

        if (current) {
            if (e.epgCurTime)  e.epgCurTime.textContent  = _tsToTime(current.start_timestamp);
            if (e.epgCurTitle) e.epgCurTitle.textContent = _decode(current.title);
            const progress = ((now - current.start_timestamp) / (current.stop_timestamp - current.start_timestamp)) * 100;
            if (e.epgProgress) e.epgProgress.style.width = Math.min(100, progress) + '%';
        }
        if (next) {
            if (e.epgNextTime)  e.epgNextTime.textContent  = _tsToTime(next.start_timestamp);
            if (e.epgNextTitle) e.epgNextTitle.textContent = _decode(next.title);
        }

        e.epgOverlay.classList.remove('hidden');
        setTimeout(() => { if (e.epgOverlay) e.epgOverlay.classList.add('hidden'); }, 8000);
    }

    function _tsToTime(ts) {
        const d = new Date(ts * 1000);
        return d.toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit', hour12: false });
    }
    function _decode(str) {
        if (!str) return '';
        try { return decodeURIComponent(escape(atob(str))); } catch (e) { return str; }
    }

    /* -------- Remote key handling (when player is active) -------- */
    function bindPlayerKeys() {
        Navigation.setHandlers({
            [KEY.PLAY]:       (e) => { resume(); showOverlay(); return false; },
            [KEY.PAUSE]:      (e) => { pause();  showOverlay(); return false; },
            [KEY.PLAY_PAUSE]: (e) => { togglePlay(); showOverlay(); return false; },
            [KEY.STOP]:       (e) => { stop(); return false; },
            [KEY.FF]:         (e) => { seek(30); return false; },
            [KEY.RW]:         (e) => { seek(-30); return false; },
            [KEY.BACK]:       (e) => { if (_callbacks.back) _callbacks.back(); return false; },
            [KEY.ENTER]:      (e) => { showOverlay(); return false; },
            [KEY.UP]:         (e) => { showOverlay(); return false; },
            [KEY.DOWN]:       (e) => { showOverlay(); return false; },
            [KEY.VOL_UP]:     (e) => { /* system volume */ return true; },
            [KEY.VOL_DOWN]:   (e) => { /* system volume */ return true; },
            [KEY.MUTE]:       (e) => { /* system mute   */ return true; }
        });
    }

    /* -------- Callbacks -------- */
    function on(event, fn) {
        _callbacks[event] = fn;
    }

    /* -------- Public -------- */
    return {
        init, play, pause, resume, togglePlay, stop, seek, seekToPercent,
        showOverlay, hideOverlay, showEPG,
        getCurrentPosition, getDuration,
        bindPlayerKeys, on
    };
})();
