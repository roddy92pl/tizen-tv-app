/**
 * app.js – Main IPTV Player application controller
 * Handles routing, page rendering, event wiring and API integration.
 */
const App = (() => {
    /* ====================================================================
       State
    ==================================================================== */
    let _currentPage  = null;
    let _pageStack    = [];
    let _liveData     = { categories: [], streams: [], activeCat: 'all', filtered: [] };
    let _vodData      = { categories: [], streams: [], activeCat: 'all', filtered: [] };
    let _seriesData   = { categories: [], series:  [], activeCat: 'all', activeSeries: null };
    let _searchTimer  = null;
    let _pinCallback  = null;
    let _pinValue     = '';
    let _quickChannel = '';
    let _quickTimer   = null;

    /* ====================================================================
       Bootstrap
    ==================================================================== */
    function init() {
        Navigation.init();
        Player.init();

        // Player callbacks
        Player.on('back', () => navigate(_pageStack[_pageStack.length - 2] || 'home'));
        Player.on('stop', () => navigate(_pageStack[_pageStack.length - 2] || 'home'));
        Player.on('ended', _onPlayerEnded);
        Player.on('error', (err) => showToast('Playback error: ' + (err.message || err), 'error'));

        // Bind global events
        _bindGlobalEvents();

        // Route
        const creds = Storage.getCredentials();
        if (creds && creds.serverUrl) {
            XtreamAPI.init(creds.serverUrl, creds.username, creds.password);
            _restoreSettings();
            navigate('home');
        } else {
            navigate('login');
        }

        hideLoading();
    }

    function _restoreSettings() {
        const s = Storage.getSettings();
        document.querySelectorAll('.option-btn').forEach(btn => {
            const setting = btn.dataset.setting;
            const value   = btn.dataset.value;
            if (setting && s[setting] === value) btn.classList.add('active');
            else if (setting)                    btn.classList.remove('active');
        });
    }

    /* ====================================================================
       Loading / Toast
    ==================================================================== */
    function showLoading(text) {
        const el = document.getElementById('loading-overlay');
        const tx = document.getElementById('loading-text');
        if (tx) tx.textContent = text || 'Loading...';
        if (el) el.classList.remove('hidden');
    }
    function hideLoading() {
        const el = document.getElementById('loading-overlay');
        if (el) el.classList.add('hidden');
    }
    function showToast(msg, type, duration) {
        const el = document.getElementById('toast');
        if (!el) return;
        el.textContent = msg;
        el.className   = 'toast show ' + (type || '');
        clearTimeout(el._timer);
        el._timer = setTimeout(() => el.classList.remove('show'), duration || 3000);
    }

    /* ====================================================================
       Routing
    ==================================================================== */
    function navigate(page, pushToStack) {
        if (pushToStack !== false) {
            if (_currentPage && _currentPage !== page) {
                _pageStack.push(_currentPage);
                if (_pageStack.length > 10) _pageStack.shift();
            }
        }
        _currentPage = page;
        _showPage(page);
    }

    function goBack() {
        const prev = _pageStack.pop();
        if (prev) {
            _currentPage = prev;
            _showPage(prev);
        }
    }

    function _showPage(page) {
        // Stop player if leaving player page
        if (page !== 'player' && document.getElementById('page-player')?.classList.contains('active')) {
            Player.stop();
        }

        document.querySelectorAll('.page').forEach(p => p.classList.remove('active'));
        const el = document.getElementById('page-' + page);
        if (el) {
            el.classList.add('active');
        }
        Navigation.clearHandlers();
        _setupPageHandlers(page);

        // Init pages
        switch (page) {
            case 'login':    _initLoginPage();   break;
            case 'home':     _initHomePage();    break;
            case 'live-tv':  _initLiveTVPage();  break;
            case 'movies':   _initMoviesPage();  break;
            case 'series':   _initSeriesPage();  break;
            case 'settings': _initSettingsPage(); break;
        }
    }

    function _setupPageHandlers(page) {
        const KEY = Navigation.KEY;
        if (page === 'player') {
            Player.bindPlayerKeys();
            return;
        }
        Navigation.on(KEY.BACK, () => {
            const overlay = document.querySelector('.details-overlay:not(.hidden), .search-overlay:not(.hidden), .dialog-overlay:not(.hidden)');
            if (overlay) {
                overlay.classList.add('hidden');
                return false;
            }
            if (_pageStack.length > 0) { goBack(); return false; }
            if (page === 'home') _confirmExit();
            return false;
        });
        // Numeric quick-channel for live TV
        if (page === 'live-tv') {
            for (let i = 0; i <= 9; i++) {
                Navigation.on(KEY['NUM_' + i], () => { _quickChannelInput(i); return false; });
            }
            Navigation.on(KEY.CH_UP,   () => { _channelSwitch(1);  return false; });
            Navigation.on(KEY.CH_DOWN, () => { _channelSwitch(-1); return false; });
            Navigation.on(KEY.RED,     () => { _toggleLiveFavorites(); return false; });
            Navigation.on(KEY.GREEN,   () => { _openLiveSearch(); return false; });
        }
        if (page === 'movies') {
            Navigation.on(KEY.RED, () => { _toggleMovieFavorites(); return false; });
            Navigation.on(KEY.GREEN, () => { _openMoviesSearch(); return false; });
        }
        if (page === 'series') {
            Navigation.on(KEY.RED, () => { _toggleSeriesFavorites(); return false; });
            Navigation.on(KEY.GREEN, () => { _openSeriesSearch(); return false; });
        }
    }

    /* ====================================================================
       Global Events
    ==================================================================== */
    function _bindGlobalEvents() {
        // Login form
        const loginForm = document.getElementById('login-form');
        if (loginForm) loginForm.addEventListener('submit', _handleLogin);

        // Home menu
        document.querySelectorAll('.menu-item[data-page]').forEach(item => {
            item.addEventListener('click', () => navigate(item.dataset.page));
        });

        // Back buttons
        document.querySelectorAll('.back-btn[data-back]').forEach(btn => {
            btn.addEventListener('click', () => navigate(btn.dataset.back));
        });

        // Global search
        const btnSearch = document.getElementById('btn-search-global');
        if (btnSearch) btnSearch.addEventListener('click', _openGlobalSearch);
        const closeSearch = document.getElementById('btn-close-search');
        if (closeSearch) closeSearch.addEventListener('click', _closeGlobalSearch);
        const globalInput = document.getElementById('global-search-input');
        if (globalInput) globalInput.addEventListener('input', _onGlobalSearch);

        // Category click delegation
        document.getElementById('live-categories')?.addEventListener('click', e => {
            const item = e.target.closest('.category-item');
            if (item) _selectLiveCategory(item.dataset.category);
        });
        document.getElementById('movies-categories')?.addEventListener('click', e => {
            const item = e.target.closest('.category-item');
            if (item) _selectVodCategory(item.dataset.category);
        });
        document.getElementById('series-categories')?.addEventListener('click', e => {
            const item = e.target.closest('.category-item');
            if (item) _selectSeriesCategory(item.dataset.category);
        });

        // Live TV search
        document.getElementById('btn-live-search')?.addEventListener('click', _openLiveSearch);
        document.getElementById('btn-live-favorites')?.addEventListener('click', _toggleLiveFavorites);
        document.getElementById('live-search-input')?.addEventListener('input', _onLiveSearch);

        // Movies search
        document.getElementById('btn-movies-search')?.addEventListener('click', _openMoviesSearch);
        document.getElementById('btn-movies-favorites')?.addEventListener('click', _toggleMovieFavorites);
        document.getElementById('movies-search-input')?.addEventListener('input', _onMoviesSearch);

        // Series search
        document.getElementById('btn-series-search')?.addEventListener('click', _openSeriesSearch);
        document.getElementById('btn-series-favorites')?.addEventListener('click', _toggleSeriesFavorites);
        document.getElementById('series-search-input')?.addEventListener('input', _onSeriesSearch);

        // Series back
        document.getElementById('btn-back-series-list')?.addEventListener('click', _backToSeriesList);

        // Season tabs delegation
        document.getElementById('season-tabs')?.addEventListener('click', e => {
            const tab = e.target.closest('.season-tab');
            if (tab) _selectSeason(tab.dataset.season);
        });

        // Episodes delegation
        document.getElementById('episodes-list')?.addEventListener('click', e => {
            const ep = e.target.closest('.episode-item');
            if (ep) _playEpisode(JSON.parse(ep.dataset.episode || '{}'));
        });

        // Movie details
        document.getElementById('btn-play-movie')?.addEventListener('click', _playCurrentMovie);
        document.getElementById('btn-resume-movie')?.addEventListener('click', _resumeCurrentMovie);
        document.getElementById('btn-fav-movie')?.addEventListener('click', _toggleCurrentMovieFav);
        document.getElementById('btn-close-details')?.addEventListener('click', () => {
            document.getElementById('movie-details-overlay')?.classList.add('hidden');
            Navigation.focusFirst(document.getElementById('page-movies'));
        });

        // Settings
        document.getElementById('btn-logout')?.addEventListener('click', _handleLogout);
        document.getElementById('btn-refresh-account')?.addEventListener('click', _refreshAccount);
        document.getElementById('btn-clear-cache')?.addEventListener('click', () => {
            Storage.clearCache();
            showToast('Cache cleared', 'success');
        });
        document.getElementById('btn-clear-history')?.addEventListener('click', () => {
            Storage.clearHistory();
            showToast('History cleared', 'success');
        });
        document.getElementById('btn-set-pin')?.addEventListener('click', _setPIN);
        document.getElementById('btn-disable-pin')?.addEventListener('click', () => {
            Storage.clearPin();
            showToast('PIN disabled', 'success');
        });
        document.getElementById('btn-add-profile')?.addEventListener('click', _addProfile);
        document.querySelectorAll('[data-setting]').forEach(btn => {
            btn.addEventListener('click', () => {
                const setting = btn.dataset.setting;
                const value   = btn.dataset.value;
                document.querySelectorAll(`[data-setting="${setting}"]`).forEach(b => b.classList.remove('active'));
                btn.classList.add('active');
                Storage.saveSettings({ [setting]: value });
            });
        });

        // PIN dialog
        document.getElementById('pin-cancel')?.addEventListener('click', _closePinDialog);
        document.querySelectorAll('.pin-btn[data-digit]').forEach(btn => {
            btn.addEventListener('click', () => _onPinDigit(btn.dataset.digit));
        });
    }

    /* ====================================================================
       LOGIN PAGE
    ==================================================================== */
    function _initLoginPage() {
        const savedUrl  = (Storage.getCredentials() || {}).serverUrl || '';
        const savedUser = (Storage.getCredentials() || {}).username  || '';
        const urlEl  = document.getElementById('server-url');
        const userEl = document.getElementById('username');
        if (urlEl  && !urlEl.value)  urlEl.value  = savedUrl;
        if (userEl && !userEl.value) userEl.value = savedUser;

        _renderProfiles();
        Navigation.focusFirst(document.getElementById('page-login'));
    }

    function _renderProfiles() {
        const profiles = Storage.getProfiles();
        const list = document.getElementById('profiles-list');
        if (!list) return;
        list.innerHTML = '';
        if (!profiles.length) {
            document.getElementById('login-profiles')?.classList.add('hidden');
            return;
        }
        document.getElementById('login-profiles')?.classList.remove('hidden');
        profiles.forEach(p => {
            const card = document.createElement('div');
            card.className = 'profile-card focusable';
            card.tabIndex  = 0;
            card.innerHTML = `<div class="profile-name">${_esc(p.label || p.username)}</div><div class="profile-server">${_esc(_truncateUrl(p.serverUrl))}</div>`;
            card.addEventListener('click', () => _loginWithProfile(p));
            list.appendChild(card);
        });
    }

    async function _handleLogin(e) {
        e.preventDefault();
        const serverUrl = document.getElementById('server-url')?.value.trim();
        const username  = document.getElementById('username')?.value.trim();
        const password  = document.getElementById('password')?.value;
        const errEl = document.getElementById('login-error');

        if (!serverUrl || !username || !password) {
            if (errEl) { errEl.textContent = 'Please fill in all fields.'; errEl.classList.remove('hidden'); }
            return;
        }

        showLoading('Connecting...');
        if (errEl) errEl.classList.add('hidden');

        XtreamAPI.init(serverUrl, username, password);
        try {
            const data = await XtreamAPI.authenticate();
            Storage.saveCredentials(serverUrl, username, password);
            Storage.saveProfile(serverUrl, username, password);
            // Store account info
            if (data && data.user_info) {
                Storage.setCache('last_account_info', data, 10 * 60 * 1000);
            }
            hideLoading();
            navigate('home');
        } catch (err) {
            hideLoading();
            if (errEl) { errEl.textContent = err.message || 'Connection failed. Check server URL and credentials.'; errEl.classList.remove('hidden'); }
        }
    }

    async function _loginWithProfile(profile) {
        showLoading('Connecting...');
        XtreamAPI.init(profile.serverUrl, profile.username, profile.password);
        try {
            await XtreamAPI.authenticate();
            Storage.saveCredentials(profile.serverUrl, profile.username, profile.password);
            hideLoading();
            navigate('home');
        } catch (err) {
            hideLoading();
            showToast('Login failed: ' + (err.message || 'Unknown error'), 'error');
        }
    }

    /* ====================================================================
       HOME PAGE
    ==================================================================== */
    function _initHomePage() {
        // Show saved username
        const creds = Storage.getCredentials();
        const userEl = document.getElementById('header-username');
        if (userEl && creds) userEl.textContent = creds.username;

        // Load account info
        _loadAccountInfo();
        // Render home sections
        _renderHomeHistory();
        _renderHomeFavorites();
        // Load counts
        _loadCounts();

        Navigation.focusFirst(document.getElementById('page-home'));
    }

    async function _loadAccountInfo() {
        try {
            const data = await XtreamAPI.getAccountInfo();
            const ui = data.user_info || data;
            const expiryEl = document.getElementById('header-expiry');
            if (expiryEl && ui.exp_date) {
                const exp = new Date(parseInt(ui.exp_date) * 1000);
                const daysLeft = Math.ceil((exp - Date.now()) / (1000 * 60 * 60 * 24));
                expiryEl.textContent = daysLeft > 0 ? `${daysLeft}d left` : 'Expired';
                expiryEl.style.color = daysLeft <= 7 ? '#e94560' : '';
            }
        } catch (e) {}
    }

    async function _loadCounts() {
        try {
            const [liveCats, vodCats, serCats] = await Promise.allSettled([
                XtreamAPI.getLiveCategories(),
                XtreamAPI.getVodCategories(),
                XtreamAPI.getSeriesCategories()
            ]);
            const liveEl = document.getElementById('count-live');
            const movEl  = document.getElementById('count-movies');
            const serEl  = document.getElementById('count-series');
            if (liveEl && liveCats.status === 'fulfilled') liveEl.textContent = (liveCats.value || []).length + ' categories';
            if (movEl  && vodCats.status  === 'fulfilled') movEl.textContent  = (vodCats.value  || []).length + ' categories';
            if (serEl  && serCats.status  === 'fulfilled') serEl.textContent  = (serCats.value  || []).length + ' categories';
        } catch (e) {}
    }

    function _renderHomeHistory() {
        const history = Storage.getHistory();
        const list    = document.getElementById('recent-list');
        const section = document.getElementById('home-recent');
        if (!list) return;
        list.innerHTML = '';
        if (!history.length) { if (section) section.style.display = 'none'; return; }
        if (section) section.style.display = '';
        history.slice(0, 10).forEach(item => {
            list.appendChild(_makeItemCard(item));
        });
    }

    function _renderHomeFavorites() {
        const favLive    = Storage.getFavorites('live');
        const favVod     = Storage.getFavorites('vod');
        const favSeries  = Storage.getFavorites('series');
        const all        = [...favLive, ...favVod, ...favSeries];
        const list       = document.getElementById('favorites-list');
        const section    = document.getElementById('home-favorites');
        if (!list) return;
        list.innerHTML = '';
        if (!all.length) { if (section) section.style.display = 'none'; return; }
        if (section) section.style.display = '';
        all.slice(0, 15).forEach(item => {
            list.appendChild(_makeItemCard(item));
        });
    }

    function _makeItemCard(item) {
        const card  = document.createElement('div');
        card.className = 'item-card focusable';
        card.tabIndex  = 0;
        const thumb = document.createElement('div');
        thumb.className = 'item-card-thumb';
        if (item.stream_icon || item.cover || item.poster) {
            const img = document.createElement('img');
            img.src = item.stream_icon || item.cover || item.poster || '';
            img.alt = item.name || item.title || '';
            img.onerror = () => { img.style.display = 'none'; thumb.textContent = item.type === 'live' ? '📺' : item.type === 'series' ? '📽' : '🎬'; };
            thumb.appendChild(img);
        } else {
            thumb.textContent = item.type === 'live' ? '📺' : item.type === 'series' ? '📽' : '🎬';
        }
        const label = document.createElement('div');
        label.className = 'item-card-label';
        label.textContent = item.name || item.title || '—';
        card.appendChild(thumb);
        card.appendChild(label);
        card.addEventListener('click', () => {
            if (item.type === 'live') _startLiveStream(item);
            else if (item.type === 'series') { navigate('series'); }
            else _showMovieDetails(item);
        });
        return card;
    }

    /* ====================================================================
       LIVE TV PAGE
    ==================================================================== */
    async function _initLiveTVPage() {
        showLoading('Loading Live TV...');
        try {
            const [cats, streams] = await Promise.all([
                XtreamAPI.getLiveCategories(),
                XtreamAPI.getLiveStreams('all')
            ]);
            _liveData.categories = cats || [];
            _liveData.streams    = streams || [];
            _liveData.filtered   = _liveData.streams;
            _renderLiveCategories();
            _renderChannels(_liveData.streams);
            hideLoading();
            Navigation.focusFirst(document.getElementById('live-categories'));
        } catch (err) {
            hideLoading();
            showToast('Failed to load Live TV: ' + err.message, 'error');
            _renderChannels([]);
        }
    }

    function _renderLiveCategories() {
        const panel = document.getElementById('live-categories');
        if (!panel) return;
        panel.innerHTML = '<div class="category-item focusable active" data-category="all" tabindex="0">All Channels</div>';
        (_liveData.categories || []).forEach(cat => {
            const item = document.createElement('div');
            item.className = 'category-item focusable';
            item.dataset.category = cat.category_id;
            item.tabIndex = 0;
            item.textContent = cat.category_name;
            panel.appendChild(item);
        });
        // Favorites category
        const favItem = document.createElement('div');
        favItem.className = 'category-item focusable';
        favItem.dataset.category = '_favorites';
        favItem.tabIndex = 0;
        favItem.textContent = '⭐ Favorites';
        panel.appendChild(favItem);
    }

    function _renderChannels(streams) {
        const grid = document.getElementById('channels-grid');
        if (!grid) return;
        if (!streams || !streams.length) {
            grid.innerHTML = '<div class="empty-state"><div class="empty-icon">📺</div><p>No channels found</p></div>';
            return;
        }
        grid.innerHTML = '';
        const frag = document.createDocumentFragment();
        streams.forEach(stream => {
            const card = _makeChannelCard(stream);
            frag.appendChild(card);
        });
        grid.appendChild(frag);
    }

    function _makeChannelCard(stream) {
        const card = document.createElement('div');
        card.className = 'channel-card focusable';
        card.tabIndex  = 0;
        const isFav = Storage.isFavorite('live', stream.stream_id);
        if (isFav) card.classList.add('is-favorite');

        const logoEl = document.createElement('div');
        logoEl.className = 'channel-logo-placeholder';
        if (stream.stream_icon) {
            const img = document.createElement('img');
            img.className = 'channel-logo';
            img.src = stream.stream_icon;
            img.alt = stream.name;
            img.onerror = () => { img.replaceWith(logoEl); };
            card.appendChild(img);
        } else {
            logoEl.textContent = '📺';
            card.appendChild(logoEl);
        }

        const info = document.createElement('div');
        info.className = 'channel-info';
        const nameEl = document.createElement('div');
        nameEl.className = 'channel-name';
        nameEl.textContent = stream.name || 'Unknown';
        const epgEl = document.createElement('div');
        epgEl.className = 'channel-epg';
        epgEl.textContent = stream.epg_channel_id ? '⏺' : '';
        info.appendChild(nameEl);
        info.appendChild(epgEl);
        card.appendChild(info);

        const favEl = document.createElement('span');
        favEl.className = 'channel-fav';
        favEl.textContent = isFav ? '⭐' : '☆';
        card.appendChild(favEl);

        card.addEventListener('click', () => _startLiveStream(stream));
        card.addEventListener('contextmenu', (e) => { e.preventDefault(); _toggleChannelFav(stream, card, favEl); });
        // Long press = favorite
        let pressTimer;
        card.addEventListener('mousedown', () => { pressTimer = setTimeout(() => _toggleChannelFav(stream, card, favEl), 700); });
        card.addEventListener('mouseup', () => clearTimeout(pressTimer));
        card.addEventListener('keydown', e => {
            if (e.keyCode === Navigation.KEY.RED) { _toggleChannelFav(stream, card, favEl); e.preventDefault(); }
        });

        return card;
    }

    function _selectLiveCategory(catId) {
        _liveData.activeCat = catId;
        document.querySelectorAll('#live-categories .category-item').forEach(el => {
            el.classList.toggle('active', el.dataset.category === catId);
        });

        if (catId === '_favorites') {
            const favIds = Storage.getFavorites('live').map(f => String(f.stream_id));
            _renderChannels(_liveData.streams.filter(s => favIds.includes(String(s.stream_id))));
        } else if (catId === 'all') {
            _renderChannels(_liveData.streams);
        } else {
            const filtered = _liveData.streams.filter(s => String(s.category_id) === String(catId));
            _renderChannels(filtered);
        }
        Navigation.focusFirst(document.getElementById('channels-grid'));
    }

    function _openLiveSearch() {
        const bar = document.getElementById('live-search-bar');
        if (!bar) return;
        bar.classList.toggle('hidden');
        if (!bar.classList.contains('hidden')) {
            const input = document.getElementById('live-search-input');
            if (input) { input.value = ''; input.focus(); Navigation.setFocusTo(input); }
        }
    }

    function _onLiveSearch(e) {
        clearTimeout(_searchTimer);
        _searchTimer = setTimeout(() => {
            const q = e.target.value.toLowerCase().trim();
            if (!q) { _renderChannels(_liveData.streams); return; }
            _renderChannels(_liveData.streams.filter(s => (s.name || '').toLowerCase().includes(q)));
        }, 300);
    }

    function _toggleLiveFavorites() {
        _selectLiveCategory(_liveData.activeCat === '_favorites' ? 'all' : '_favorites');
    }

    function _toggleChannelFav(stream, card, favEl) {
        const id = stream.stream_id;
        if (Storage.isFavorite('live', id)) {
            Storage.removeFavorite('live', id);
            card.classList.remove('is-favorite');
            if (favEl) favEl.textContent = '☆';
            showToast('Removed from favorites', 'info');
        } else {
            Storage.addFavorite('live', { ...stream, type: 'live' });
            card.classList.add('is-favorite');
            if (favEl) favEl.textContent = '⭐';
            showToast('Added to favorites', 'success');
        }
    }

    function _quickChannelInput(digit) {
        clearTimeout(_quickTimer);
        _quickChannel += String(digit);
        showToast('Channel: ' + _quickChannel, 'info', 1500);
        _quickTimer = setTimeout(() => {
            const num = parseInt(_quickChannel);
            _quickChannel = '';
            const target = _liveData.filtered[num - 1];
            if (target) _startLiveStream(target);
        }, 1500);
    }

    function _channelSwitch(direction) {
        const streams = _liveData.filtered.length ? _liveData.filtered : _liveData.streams;
        const focused = document.querySelector('#channels-grid .channel-card.focused');
        if (!focused) return;
        const all = Array.from(document.querySelectorAll('#channels-grid .channel-card'));
        const idx = all.indexOf(focused);
        const next = all[idx + direction];
        if (next) Navigation.setFocusTo(next);
    }

    async function _startLiveStream(stream) {
        const creds = Storage.getCredentials();
        const settings = Storage.getSettings();
        const ext = settings.format !== 'auto' ? settings.format : 'ts';
        const url = XtreamAPI.getLiveStreamUrl(stream.stream_id, ext);

        Storage.addToHistory({ type: 'live', id: stream.stream_id, name: stream.name, stream_icon: stream.stream_icon });

        navigate('player');
        Player.play(url, 'live', {
            id:       stream.stream_id,
            title:    stream.name,
            subtitle: '',
            logo:     stream.stream_icon
        });

        // Fetch EPG
        try {
            const epgData = await XtreamAPI.getLiveEPG(stream.stream_id, 2);
            if (epgData) Player.showEPG(epgData);
        } catch (e) {}
    }

    /* ====================================================================
       MOVIES PAGE
    ==================================================================== */
    let _currentMovieStream = null;

    async function _initMoviesPage() {
        showLoading('Loading Movies...');
        try {
            const [cats, streams] = await Promise.all([
                XtreamAPI.getVodCategories(),
                XtreamAPI.getVodStreams('all')
            ]);
            _vodData.categories = cats || [];
            _vodData.streams    = streams || [];
            _renderVodCategories();
            _renderMovies(_vodData.streams);
            hideLoading();
            Navigation.focusFirst(document.getElementById('movies-categories'));
        } catch (err) {
            hideLoading();
            showToast('Failed to load Movies: ' + err.message, 'error');
        }
    }

    function _renderVodCategories() {
        const panel = document.getElementById('movies-categories');
        if (!panel) return;
        panel.innerHTML = '<div class="category-item focusable active" data-category="all" tabindex="0">All Movies</div>';
        (_vodData.categories || []).forEach(cat => {
            const item = document.createElement('div');
            item.className = 'category-item focusable';
            item.dataset.category = cat.category_id;
            item.tabIndex = 0;
            item.textContent = cat.category_name;
            panel.appendChild(item);
        });
        const favItem = document.createElement('div');
        favItem.className = 'category-item focusable';
        favItem.dataset.category = '_favorites';
        favItem.tabIndex = 0;
        favItem.textContent = '⭐ Favorites';
        panel.appendChild(favItem);
    }

    function _renderMovies(streams) {
        const grid = document.getElementById('movies-grid');
        if (!grid) return;
        if (!streams || !streams.length) {
            grid.innerHTML = '<div class="empty-state"><div class="empty-icon">🎬</div><p>No movies found</p></div>';
            return;
        }
        grid.innerHTML = '';
        const frag = document.createDocumentFragment();
        streams.forEach(stream => {
            const card = _makeMediaCard(stream, 'vod');
            frag.appendChild(card);
        });
        grid.appendChild(frag);
    }

    function _makeMediaCard(item, type) {
        const card = document.createElement('div');
        card.className = 'media-card focusable';
        card.tabIndex  = 0;

        const poster = item.stream_icon || item.cover || '';
        const posterEl = document.createElement('div');

        if (poster) {
            const img = document.createElement('img');
            img.className = 'media-poster';
            img.src = poster;
            img.alt = item.name || item.title || '';
            img.loading = 'lazy';
            img.onerror = () => {
                const ph = document.createElement('div');
                ph.className = 'media-poster-placeholder';
                ph.textContent = type === 'series' ? '📽' : '🎬';
                img.replaceWith(ph);
            };
            card.appendChild(img);
        } else {
            posterEl.className = 'media-poster-placeholder';
            posterEl.textContent = type === 'series' ? '📽' : '🎬';
            card.appendChild(posterEl);
        }

        const titleEl = document.createElement('div');
        titleEl.className = 'media-title';
        titleEl.textContent = item.name || item.title || '—';
        card.appendChild(titleEl);

        if (item.year) {
            const yearEl = document.createElement('div');
            yearEl.className = 'media-year';
            yearEl.textContent = item.year;
            card.appendChild(yearEl);
        }
        if (item.rating) {
            const ratingEl = document.createElement('div');
            ratingEl.className = 'media-rating';
            ratingEl.textContent = '★ ' + item.rating;
            card.appendChild(ratingEl);
        }

        if (type === 'vod') {
            card.addEventListener('click', () => _showMovieDetails(item));
        } else {
            card.addEventListener('click', () => _showSeriesDetails(item));
        }
        return card;
    }

    function _selectVodCategory(catId) {
        _vodData.activeCat = catId;
        document.querySelectorAll('#movies-categories .category-item').forEach(el => {
            el.classList.toggle('active', el.dataset.category === catId);
        });
        if (catId === '_favorites') {
            const favIds = Storage.getFavorites('vod').map(f => String(f.stream_id));
            _renderMovies(_vodData.streams.filter(s => favIds.includes(String(s.stream_id))));
        } else if (catId === 'all') {
            _renderMovies(_vodData.streams);
        } else {
            _renderMovies(_vodData.streams.filter(s => String(s.category_id) === String(catId)));
        }
        Navigation.focusFirst(document.getElementById('movies-grid'));
    }

    function _openMoviesSearch() {
        const bar = document.getElementById('movies-search-bar');
        if (!bar) return;
        bar.classList.toggle('hidden');
        if (!bar.classList.contains('hidden')) {
            const input = document.getElementById('movies-search-input');
            if (input) { input.value = ''; input.focus(); Navigation.setFocusTo(input); }
        }
    }

    function _onMoviesSearch(e) {
        clearTimeout(_searchTimer);
        _searchTimer = setTimeout(() => {
            const q = e.target.value.toLowerCase().trim();
            if (!q) { _renderMovies(_vodData.streams); return; }
            _renderMovies(_vodData.streams.filter(s => (s.name || '').toLowerCase().includes(q)));
        }, 300);
    }

    function _toggleMovieFavorites() {
        _selectVodCategory(_vodData.activeCat === '_favorites' ? 'all' : '_favorites');
    }

    async function _showMovieDetails(stream) {
        _currentMovieStream = stream;
        const overlay = document.getElementById('movie-details-overlay');
        if (!overlay) return;
        overlay.classList.remove('hidden');

        // Populate basic info
        document.getElementById('details-title').textContent       = stream.name || stream.title || '—';
        document.getElementById('details-year').textContent        = stream.year || '';
        document.getElementById('details-rating').textContent      = stream.rating ? '★ ' + stream.rating : '';
        document.getElementById('details-duration').textContent    = stream.duration ? _formatDuration(stream.duration) : '';
        document.getElementById('details-genre').textContent       = stream.genre || stream.category_name || '';
        document.getElementById('details-description').textContent = stream.plot || stream.description || stream.stream_type || '';

        const posterImg = document.getElementById('details-poster-img');
        const posterPh  = document.getElementById('details-poster-placeholder');
        if (posterImg) {
            posterImg.src = stream.stream_icon || stream.cover || '';
            posterImg.style.display = (stream.stream_icon || stream.cover) ? '' : 'none';
            if (posterPh) posterPh.style.display = (stream.stream_icon || stream.cover) ? 'none' : '';
        }

        // Resume button
        const savedPos = Storage.getPosition(stream.stream_id);
        const resumeBtn = document.getElementById('btn-resume-movie');
        if (resumeBtn) resumeBtn.classList.toggle('hidden', !savedPos);

        // Favorite button
        const favBtn = document.getElementById('btn-fav-movie');
        if (favBtn) favBtn.textContent = Storage.isFavorite('vod', stream.stream_id) ? '⭐ Favorited' : '☆ Favorite';

        // Fetch full info
        try {
            const info = await XtreamAPI.getVodInfo(stream.stream_id);
            if (info && info.info) {
                const i = info.info;
                if (i.plot)   document.getElementById('details-description').textContent = i.plot;
                if (i.genre)  document.getElementById('details-genre').textContent = i.genre;
                if (i.duration_secs) document.getElementById('details-duration').textContent = _formatDuration(Math.floor(i.duration_secs / 60));
                if (i.rating) document.getElementById('details-rating').textContent = '★ ' + i.rating;
                if (i.releasedate) document.getElementById('details-year').textContent = i.releasedate.split('-')[0];
                if (i.movie_image && posterImg) {
                    posterImg.src = i.movie_image;
                    posterImg.style.display = '';
                    if (posterPh) posterPh.style.display = 'none';
                }
            }
        } catch (e) {}

        Navigation.setFocusTo(document.getElementById('btn-play-movie'));
    }

    function _playCurrentMovie() {
        if (!_currentMovieStream) return;
        _playMovie(_currentMovieStream, 0);
    }
    function _resumeCurrentMovie() {
        if (!_currentMovieStream) return;
        const pos = Storage.getPosition(_currentMovieStream.stream_id);
        _playMovie(_currentMovieStream, pos ? pos.position : 0);
    }
    function _toggleCurrentMovieFav() {
        if (!_currentMovieStream) return;
        const id = _currentMovieStream.stream_id;
        if (Storage.isFavorite('vod', id)) {
            Storage.removeFavorite('vod', id);
            const btn = document.getElementById('btn-fav-movie');
            if (btn) btn.textContent = '☆ Favorite';
            showToast('Removed from favorites', 'info');
        } else {
            Storage.addFavorite('vod', { ..._currentMovieStream, type: 'vod' });
            const btn = document.getElementById('btn-fav-movie');
            if (btn) btn.textContent = '⭐ Favorited';
            showToast('Added to favorites', 'success');
        }
    }

    function _playMovie(stream, startPosition) {
        document.getElementById('movie-details-overlay')?.classList.add('hidden');
        const settings = Storage.getSettings();
        const ext = stream.container_extension || (settings.format !== 'auto' ? settings.format : 'mp4');
        const url = XtreamAPI.getVodStreamUrl(stream.stream_id, ext);

        Storage.addToHistory({ type: 'vod', id: stream.stream_id, name: stream.name, stream_icon: stream.stream_icon });

        navigate('player');
        Player.play(url, 'vod', {
            id:       stream.stream_id,
            title:    stream.name,
            subtitle: stream.year || '',
            logo:     stream.stream_icon
        }, startPosition);
    }

    /* ====================================================================
       SERIES PAGE
    ==================================================================== */
    async function _initSeriesPage() {
        _backToSeriesList();
        showLoading('Loading Series...');
        try {
            const [cats, series] = await Promise.all([
                XtreamAPI.getSeriesCategories(),
                XtreamAPI.getSeries('all')
            ]);
            _seriesData.categories = cats  || [];
            _seriesData.series     = series || [];
            _renderSeriesCategories();
            _renderSeriesGrid(_seriesData.series);
            hideLoading();
            Navigation.focusFirst(document.getElementById('series-categories'));
        } catch (err) {
            hideLoading();
            showToast('Failed to load Series: ' + err.message, 'error');
        }
    }

    function _renderSeriesCategories() {
        const panel = document.getElementById('series-categories');
        if (!panel) return;
        panel.innerHTML = '<div class="category-item focusable active" data-category="all" tabindex="0">All Series</div>';
        (_seriesData.categories || []).forEach(cat => {
            const item = document.createElement('div');
            item.className = 'category-item focusable';
            item.dataset.category = cat.category_id;
            item.tabIndex = 0;
            item.textContent = cat.category_name;
            panel.appendChild(item);
        });
        const favItem = document.createElement('div');
        favItem.className = 'category-item focusable';
        favItem.dataset.category = '_favorites';
        favItem.tabIndex = 0;
        favItem.textContent = '⭐ Favorites';
        panel.appendChild(favItem);
    }

    function _renderSeriesGrid(series) {
        const grid = document.getElementById('series-grid');
        if (!grid) return;
        if (!series || !series.length) {
            grid.innerHTML = '<div class="empty-state"><div class="empty-icon">📽</div><p>No series found</p></div>';
            return;
        }
        grid.innerHTML = '';
        const frag = document.createDocumentFragment();
        series.forEach(s => frag.appendChild(_makeMediaCard(s, 'series')));
        grid.appendChild(frag);
    }

    function _selectSeriesCategory(catId) {
        _seriesData.activeCat = catId;
        document.querySelectorAll('#series-categories .category-item').forEach(el => {
            el.classList.toggle('active', el.dataset.category === catId);
        });
        if (catId === '_favorites') {
            const favIds = Storage.getFavorites('series').map(f => String(f.series_id));
            _renderSeriesGrid(_seriesData.series.filter(s => favIds.includes(String(s.series_id))));
        } else if (catId === 'all') {
            _renderSeriesGrid(_seriesData.series);
        } else {
            _renderSeriesGrid(_seriesData.series.filter(s => String(s.category_id) === String(catId)));
        }
        Navigation.focusFirst(document.getElementById('series-grid'));
    }

    function _openSeriesSearch() {
        const bar = document.getElementById('series-search-bar');
        if (!bar) return;
        bar.classList.toggle('hidden');
        if (!bar.classList.contains('hidden')) {
            const input = document.getElementById('series-search-input');
            if (input) { input.value = ''; input.focus(); Navigation.setFocusTo(input); }
        }
    }

    function _onSeriesSearch(e) {
        clearTimeout(_searchTimer);
        _searchTimer = setTimeout(() => {
            const q = e.target.value.toLowerCase().trim();
            if (!q) { _renderSeriesGrid(_seriesData.series); return; }
            _renderSeriesGrid(_seriesData.series.filter(s => (s.name || s.title || '').toLowerCase().includes(q)));
        }, 300);
    }

    function _toggleSeriesFavorites() {
        _selectSeriesCategory(_seriesData.activeCat === '_favorites' ? 'all' : '_favorites');
    }

    async function _showSeriesDetails(series) {
        _seriesData.activeSeries = series;
        const browsePanel  = document.getElementById('series-browse-panel');
        const detailPanel  = document.getElementById('series-detail-panel');
        if (!browsePanel || !detailPanel) return;

        browsePanel.style.display  = 'none';
        detailPanel.classList.remove('hidden');

        document.getElementById('series-detail-title').textContent = series.name || series.title || '—';
        document.getElementById('series-detail-desc').textContent  = series.plot || series.description || '';
        const poster = document.getElementById('series-detail-poster');
        if (poster) { poster.src = series.cover || series.stream_icon || ''; poster.alt = series.name || ''; }

        showLoading('Loading episodes...');
        try {
            const info = await XtreamAPI.getSeriesInfo(series.series_id);
            hideLoading();
            if (!info) { showToast('Could not load series info', 'error'); return; }
            if (info.info && info.info.plot) {
                document.getElementById('series-detail-desc').textContent = info.info.plot;
            }
            _renderSeasons(info.seasons || [], info.episodes || {});
        } catch (err) {
            hideLoading();
            showToast('Failed to load series: ' + err.message, 'error');
        }
    }

    function _renderSeasons(seasons, episodesMap) {
        _seriesData._episodesMap = episodesMap;
        const tabsEl = document.getElementById('season-tabs');
        if (!tabsEl) return;
        tabsEl.innerHTML = '';

        const seasonNums = Object.keys(episodesMap).sort((a, b) => Number(a) - Number(b));
        if (!seasonNums.length) {
            document.getElementById('episodes-list').innerHTML = '<div class="empty-state"><p>No episodes found</p></div>';
            return;
        }

        seasonNums.forEach((num, idx) => {
            const tab = document.createElement('div');
            tab.className = 'season-tab focusable' + (idx === 0 ? ' active' : '');
            tab.dataset.season = num;
            tab.tabIndex = 0;
            tab.textContent = 'Season ' + num;
            tabsEl.appendChild(tab);
        });

        _selectSeason(seasonNums[0]);
        Navigation.setFocusTo(tabsEl.querySelector('.season-tab.active'));
    }

    function _selectSeason(seasonNum) {
        document.querySelectorAll('.season-tab').forEach(t => t.classList.toggle('active', t.dataset.season === String(seasonNum)));
        const episodes = (_seriesData._episodesMap || {})[seasonNum] || [];
        _renderEpisodes(episodes);
    }

    function _renderEpisodes(episodes) {
        const list = document.getElementById('episodes-list');
        if (!list) return;
        list.innerHTML = '';
        if (!episodes.length) {
            list.innerHTML = '<div class="empty-state"><p>No episodes in this season</p></div>';
            return;
        }
        episodes.forEach(ep => {
            const item = document.createElement('div');
            item.className = 'episode-item focusable';
            item.tabIndex  = 0;
            item.dataset.episode = JSON.stringify(ep);

            const pos = Storage.getPosition(ep.id);

            item.innerHTML = `
                <div class="episode-num">${_esc(ep.episode_num || ep.id || '?')}</div>
                <div class="episode-info">
                    <div class="episode-title">${_esc(ep.title || 'Episode ' + ep.episode_num)}</div>
                    <div class="episode-desc">${_esc(ep.info && ep.info.plot ? ep.info.plot : '')}</div>
                    ${pos ? `<div class="episode-progress"><div class="episode-progress-fill" style="width:${Math.round((pos.position/pos.duration)*100)}%"></div></div>` : ''}
                </div>
                ${ep.info && ep.info.duration ? `<div class="episode-duration">${_esc(ep.info.duration)}</div>` : ''}
                ${pos && pos.position/pos.duration > 0.9 ? '<div class="episode-watched">✓</div>' : ''}
            `;
            list.appendChild(item);
        });
        Navigation.focusFirst(list);
    }

    function _playEpisode(episode) {
        if (!episode || !episode.id) return;
        const series = _seriesData.activeSeries;
        const ext = episode.container_extension || 'mkv';
        const url = XtreamAPI.getSeriesStreamUrl(episode.id, ext);
        const saved = Storage.getPosition(episode.id);

        Storage.addToHistory({ type: 'series', id: episode.id, name: (series ? series.name + ' – ' : '') + (episode.title || 'Episode'), stream_icon: series && series.cover });

        navigate('player');
        Player.play(url, 'series', {
            id:       episode.id,
            title:    series ? series.name : '',
            subtitle: episode.title || 'Episode ' + episode.episode_num,
            logo:     series && series.cover
        }, saved ? saved.position : 0);
    }

    function _backToSeriesList() {
        const browsePanel = document.getElementById('series-browse-panel');
        const detailPanel = document.getElementById('series-detail-panel');
        if (browsePanel) browsePanel.style.display = '';
        if (detailPanel) detailPanel.classList.add('hidden');
        _seriesData.activeSeries = null;
        Navigation.focusFirst(document.getElementById('series-grid'));
    }

    /* ====================================================================
       PLAYER – auto next episode
    ==================================================================== */
    function _onPlayerEnded() {
        // If watching series, try to play next episode
        if (!_seriesData.activeSeries || !_seriesData._episodesMap) return;
        const history = Storage.getHistory('series');
        if (!history.length) return;
        const last = history[0];
        const season = Object.keys(_seriesData._episodesMap).find(s => {
            return (_seriesData._episodesMap[s] || []).some(ep => ep.id === last.id);
        });
        if (!season) return;
        const eps = _seriesData._episodesMap[season];
        const idx = eps.findIndex(ep => ep.id === last.id);
        if (idx >= 0 && idx + 1 < eps.length) {
            showToast('Playing next episode…', 'info', 2000);
            setTimeout(() => _playEpisode(eps[idx + 1]), 2000);
        }
    }

    /* ====================================================================
       SETTINGS PAGE
    ==================================================================== */
    async function _initSettingsPage() {
        const creds = Storage.getCredentials();
        if (creds) {
            document.getElementById('set-server').textContent   = creds.serverUrl || '—';
            document.getElementById('set-username').textContent = creds.username  || '—';
        }
        // Load account info
        try {
            const data = await XtreamAPI.getAccountInfo();
            const ui   = (data && data.user_info) || {};
            document.getElementById('set-status').textContent      = ui.status || '—';
            document.getElementById('set-connections').textContent = (ui.active_cons || '?') + ' / ' + (ui.max_connections || '?');
            if (ui.exp_date) {
                const d = new Date(parseInt(ui.exp_date) * 1000);
                document.getElementById('set-expiry').textContent = d.toLocaleDateString();
            }
        } catch (e) {
            document.getElementById('set-status').textContent = 'Unknown';
        }
        // Profiles list
        _renderProfilesSettings();
        Navigation.focusFirst(document.getElementById('page-settings'));
    }

    function _renderProfilesSettings() {
        const list = document.getElementById('profiles-settings-list');
        if (!list) return;
        list.innerHTML = '';
        Storage.getProfiles().forEach(p => {
            const item = document.createElement('div');
            item.className = 'profile-settings-item';
            item.innerHTML = `<div class="profile-name">${_esc(p.label || p.username)}</div><div class="profile-server">${_esc(p.serverUrl)}</div><button class="btn btn-outline focusable" style="font-size:20px" data-server="${_esc(p.serverUrl)}" data-user="${_esc(p.username)}">Delete</button>`;
            item.querySelector('button').addEventListener('click', () => {
                Storage.deleteProfile(p.serverUrl, p.username);
                _renderProfilesSettings();
                showToast('Profile deleted', 'info');
            });
            list.appendChild(item);
        });
    }

    async function _refreshAccount() {
        Storage.clearCache();
        await _loadAccountInfo();
        showToast('Account info refreshed', 'success');
    }

    function _handleLogout() {
        Player.stop();
        Storage.clearCredentials();
        Storage.clearCache();
        navigate('login', false);
        _pageStack = [];
    }

    function _addProfile() {
        navigate('login');
    }

    /* ====================================================================
       GLOBAL SEARCH
    ==================================================================== */
    function _openGlobalSearch() {
        const overlay = document.getElementById('search-overlay');
        if (!overlay) return;
        overlay.classList.remove('hidden');
        const input = document.getElementById('global-search-input');
        if (input) { input.value = ''; Navigation.setFocusTo(input); }
    }
    function _closeGlobalSearch() {
        document.getElementById('search-overlay')?.classList.add('hidden');
        Navigation.focusFirst(document.getElementById('page-' + _currentPage));
    }

    function _onGlobalSearch(e) {
        clearTimeout(_searchTimer);
        _searchTimer = setTimeout(async () => {
            const q = e.target.value.trim();
            if (!q || q.length < 2) return;
            try {
                const [live, vod, series] = await Promise.allSettled([
                    XtreamAPI.searchLive(q),
                    XtreamAPI.searchVod(q),
                    XtreamAPI.searchSeries(q)
                ]);
                _renderSearchSection('search-live-results',    live.value   || [], 'live');
                _renderSearchSection('search-movies-results',  vod.value    || [], 'vod');
                _renderSearchSection('search-series-results',  series.value || [], 'series');
                document.getElementById('search-live-section')?.classList.toggle('hidden',   !(live.value   || []).length);
                document.getElementById('search-movies-section')?.classList.toggle('hidden', !(vod.value    || []).length);
                document.getElementById('search-series-section')?.classList.toggle('hidden', !(series.value || []).length);
            } catch (err) {}
        }, 400);
    }

    function _renderSearchSection(containerId, items, type) {
        const el = document.getElementById(containerId);
        if (!el) return;
        el.innerHTML = '';
        items.slice(0, 20).forEach(item => {
            const card = document.createElement('div');
            card.className = 'item-card focusable';
            card.tabIndex  = 0;
            const thumb = document.createElement('div');
            thumb.className = 'item-card-thumb';
            const icon = item.stream_icon || item.cover || '';
            if (icon) {
                const img = document.createElement('img');
                img.src = icon; img.alt = item.name || '';
                img.onerror = () => { img.style.display='none'; thumb.textContent = type === 'live' ? '📺' : type === 'series' ? '📽' : '🎬'; };
                thumb.appendChild(img);
            } else {
                thumb.textContent = type === 'live' ? '📺' : type === 'series' ? '📽' : '🎬';
            }
            const label = document.createElement('div');
            label.className = 'item-card-label';
            label.textContent = item.name || item.title || '—';
            card.appendChild(thumb);
            card.appendChild(label);
            card.addEventListener('click', () => {
                _closeGlobalSearch();
                if (type === 'live')   _startLiveStream(item);
                else if (type === 'vod') { navigate('movies'); _showMovieDetails(item); }
                else { navigate('series'); _showSeriesDetails(item); }
            });
            el.appendChild(card);
        });
    }

    /* ====================================================================
       PIN DIALOG
    ==================================================================== */
    function showPinDialog(title, callback) {
        _pinCallback = callback;
        _pinValue    = '';
        _updatePinDots();
        const el = document.getElementById('pin-dialog');
        const t  = document.getElementById('pin-dialog-title');
        if (t) t.textContent = title || 'Enter PIN';
        if (el) el.classList.remove('hidden');
        Navigation.setFocusTo(document.querySelector('.pin-btn[data-digit="1"]'));
    }
    function _closePinDialog() {
        _pinValue = '';
        _updatePinDots();
        document.getElementById('pin-dialog')?.classList.add('hidden');
        _pinCallback = null;
    }
    function _onPinDigit(digit) {
        if (digit === 'del') {
            _pinValue = _pinValue.slice(0, -1);
        } else {
            if (_pinValue.length >= 4) return;
            _pinValue += digit;
        }
        _updatePinDots();
        if (_pinValue.length === 4 && _pinCallback) {
            const cb = _pinCallback;
            _closePinDialog();
            cb(_pinValue);
        }
    }
    function _updatePinDots() {
        for (let i = 0; i < 4; i++) {
            document.getElementById('dot-' + i)?.classList.toggle('filled', i < _pinValue.length);
        }
    }
    function _setPIN() {
        showPinDialog('Set New PIN', (pin) => {
            Storage.savePin(pin);
            showToast('PIN set successfully', 'success');
        });
    }

    /* ====================================================================
       EXIT CONFIRMATION
    ==================================================================== */
    function _confirmExit() {
        if (confirm('Exit IPTV Player?')) {
            try { tizen.application.getCurrentApplication().exit(); } catch (e) { window.close(); }
        }
    }

    /* ====================================================================
       HELPERS
    ==================================================================== */
    function _esc(str) {
        if (!str) return '';
        return String(str)
            .replace(/&/g, '&amp;')
            .replace(/</g, '&lt;')
            .replace(/>/g, '&gt;')
            .replace(/"/g, '&quot;')
            .replace(/'/g, '&#039;');
    }
    function _truncateUrl(url) {
        if (!url) return '';
        return url.replace(/^https?:\/\//, '').replace(/\/.*/, '').substring(0, 30);
    }
    function _formatDuration(minutes) {
        if (!minutes) return '';
        const h = Math.floor(minutes / 60);
        const m = minutes % 60;
        return h > 0 ? `${h}h ${m}m` : `${m}m`;
    }

    /* ====================================================================
       Public
    ==================================================================== */
    return {
        init,
        navigate, goBack,
        showLoading, hideLoading, showToast,
        showPinDialog
    };
})();

/* ===== Bootstrap ===== */
document.addEventListener('DOMContentLoaded', () => {
    App.init();
});
