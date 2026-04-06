/**
 * navigation.js – TV Remote / D-pad navigation manager
 * Handles Samsung Tizen key registration, focus management and spatial navigation.
 */
const Navigation = (() => {
    /* ---------- Key Codes ---------- */
    const KEY = {
        UP:      38,
        DOWN:    40,
        LEFT:    37,
        RIGHT:   39,
        ENTER:   13,
        BACK:    10009,
        EXIT:    10182,
        PLAY:    415,
        PAUSE:   19,
        PLAY_PAUSE: 10252,
        STOP:    413,
        FF:      417,
        RW:      412,
        CH_UP:   427,
        CH_DOWN: 428,
        VOL_UP:  447,
        VOL_DOWN:448,
        MUTE:    449,
        RED:     403,
        GREEN:   404,
        YELLOW:  405,
        BLUE:    406,
        NUM_0:   48, NUM_1: 49, NUM_2: 50, NUM_3: 51, NUM_4: 52,
        NUM_5:   53, NUM_6: 54, NUM_7: 55, NUM_8: 56, NUM_9: 57
    };

    let _currentFocus = null;
    let _keyHandlers  = {};
    let _tizenInputDevice = null;

    /* ---------- Init ---------- */
    function init() {
        _registerTizenKeys();
        document.addEventListener('keydown', _onKeyDown);
    }

    function _registerTizenKeys() {
        try {
            _tizenInputDevice = tizen && tizen.tvinputdevice;
        } catch (e) {
            _tizenInputDevice = null;
        }
        if (!_tizenInputDevice) return;

        const keysToRegister = [
            'MediaPlay', 'MediaPause', 'MediaStop', 'MediaFastForward', 'MediaRewind',
            'MediaPlayPause', 'ChannelUp', 'ChannelDown',
            'ColorF0Red', 'ColorF1Green', 'ColorF2Yellow', 'ColorF3Blue',
            'VolumeUp', 'VolumeDown', 'VolumeMute',
            '0', '1', '2', '3', '4', '5', '6', '7', '8', '9'
        ];
        keysToRegister.forEach(key => {
            try { _tizenInputDevice.registerKey(key); } catch (e) {}
        });
    }

    /* ---------- Key Event Dispatcher ---------- */
    function _onKeyDown(e) {
        const code = e.keyCode;

        // Run page-level handler first
        if (_keyHandlers[code]) {
            const result = _keyHandlers[code](e);
            if (result === false) { e.preventDefault(); return; }
        }

        // Spatial navigation
        switch (code) {
            case KEY.UP:    e.preventDefault(); moveFocus('up');    break;
            case KEY.DOWN:  e.preventDefault(); moveFocus('down');  break;
            case KEY.LEFT:  e.preventDefault(); moveFocus('left');  break;
            case KEY.RIGHT: e.preventDefault(); moveFocus('right'); break;
            case KEY.ENTER:
                if (_currentFocus) { e.preventDefault(); _currentFocus.click(); }
                break;
        }
    }

    /* ---------- Focus Management ---------- */
    function setFocusTo(element) {
        if (!element) return;
        if (_currentFocus && _currentFocus !== element) {
            _currentFocus.classList.remove('focused');
        }
        _currentFocus = element;
        element.classList.add('focused');
        element.focus({ preventScroll: true });
        _scrollIntoViewIfNeeded(element);
    }

    function focusFirst(container) {
        const el = container
            ? container.querySelector('.focusable:not([disabled]):not(.hidden)')
            : document.querySelector('.page.active .focusable:not([disabled]):not(.hidden)');
        if (el) setFocusTo(el);
    }

    function moveFocus(direction) {
        const active = _currentFocus || document.querySelector('.page.active .focusable');
        if (!active) { focusFirst(); return; }

        const candidates = Array.from(
            document.querySelectorAll('.focusable:not([disabled]):not([style*="display: none"]):not([style*="display:none"])')
        ).filter(el => {
            if (el === active) return false;
            // Check visibility
            return el.offsetParent !== null && !_isHiddenByAncestor(el);
        });

        const activeRect = active.getBoundingClientRect();
        const best = _findBestCandidate(activeRect, candidates, direction);
        if (best) setFocusTo(best);
    }

    function _isHiddenByAncestor(el) {
        let node = el;
        while (node && node !== document.body) {
            const style = window.getComputedStyle(node);
            if (style.display === 'none' || style.visibility === 'hidden' || node.classList.contains('hidden')) {
                return true;
            }
            node = node.parentElement;
        }
        return false;
    }

    function _findBestCandidate(fromRect, candidates, direction) {
        let best = null;
        let bestScore = Infinity;

        for (const el of candidates) {
            const rect = el.getBoundingClientRect();
            if (rect.width === 0 || rect.height === 0) continue;

            const cx = rect.left + rect.width  / 2;
            const cy = rect.top  + rect.height / 2;
            const fx = fromRect.left + fromRect.width  / 2;
            const fy = fromRect.top  + fromRect.height / 2;

            let primary, secondary;
            let inDirection = false;

            switch (direction) {
                case 'up':
                    inDirection = rect.bottom <= fromRect.top + 4;
                    primary   = fy - cy;
                    secondary = Math.abs(cx - fx);
                    break;
                case 'down':
                    inDirection = rect.top >= fromRect.bottom - 4;
                    primary   = cy - fy;
                    secondary = Math.abs(cx - fx);
                    break;
                case 'left':
                    inDirection = rect.right <= fromRect.left + 4;
                    primary   = fx - cx;
                    secondary = Math.abs(cy - fy);
                    break;
                case 'right':
                    inDirection = rect.left >= fromRect.right - 4;
                    primary   = cx - fx;
                    secondary = Math.abs(cy - fy);
                    break;
            }

            if (!inDirection || primary <= 0) continue;

            // Score: weighted combination of primary distance + perpendicular offset
            const score = primary + secondary * 2;
            if (score < bestScore) {
                bestScore = score;
                best = el;
            }
        }
        return best;
    }

    function _scrollIntoViewIfNeeded(el) {
        const scrollContainers = [
            el.closest('.categories-panel'),
            el.closest('.content-panel'),
            el.closest('.episodes-list'),
            el.closest('.settings-content'),
            el.closest('.home-content')
        ].filter(Boolean);

        scrollContainers.forEach(container => {
            const rect   = el.getBoundingClientRect();
            const cRect  = container.getBoundingClientRect();
            const margin = 60;

            if (rect.top < cRect.top + margin) {
                container.scrollTop -= (cRect.top + margin - rect.top);
            } else if (rect.bottom > cRect.bottom - margin) {
                container.scrollTop += (rect.bottom - cRect.bottom + margin);
            }

            if (rect.left < cRect.left + margin) {
                container.scrollLeft -= (cRect.left + margin - rect.left);
            } else if (rect.right > cRect.right - margin) {
                container.scrollLeft += (rect.right - cRect.right + margin);
            }
        });
    }

    /* ---------- Custom Key Handlers ---------- */
    function on(keyCode, handler) {
        _keyHandlers[keyCode] = handler;
    }
    function off(keyCode) {
        delete _keyHandlers[keyCode];
    }
    function clearHandlers() {
        _keyHandlers = {};
    }
    function setHandlers(map) {
        clearHandlers();
        Object.entries(map).forEach(([code, fn]) => { _keyHandlers[Number(code)] = fn; });
    }

    /* ---------- Public ---------- */
    return {
        KEY,
        init,
        setFocusTo, focusFirst, moveFocus,
        on, off, clearHandlers, setHandlers
    };
})();
