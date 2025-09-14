import React, { useState, useEffect, useRef } from 'react';
import YouTube from 'react-youtube';
import './App.css';
import './theme.css';

/** Optional: ErrorBoundary to show render errors instead of a blank screen */
class ErrorBoundary extends React.Component {
  constructor(props) {
    super(props);
    this.state = { hasError: false, error: null, info: null };
  }
  static getDerivedStateFromError() {
    return { hasError: true };
  }
  componentDidCatch(error, info) {
    this.setState({ error, info });
    console.error('[ErrorBoundary] Render error:', error, info);
  }
  render() {
    if (this.state.hasError) {
      return (
        <div style={{ padding: 16, background: '#fff5f5', color: '#b00020', border: '1px solid #ffcdd2', borderRadius: 8 }}>
          <h3 style={{ marginTop: 0 }}>Something broke while rendering</h3>
          <div style={{ fontFamily: 'monospace', whiteSpace: 'pre-wrap' }}>
            {String(this.state.error)}
          </div>
          <button
            onClick={() => this.setState({ hasError: false, error: null, info: null })}
            style={{ marginTop: 12 }}
          >
            Try to render anyway
          </button>
        </div>
      );
    }
    return this.props.children;
  }
}

function App() {
  // ===== Config =====
  const CLIENT_ID = '53619685564-bbu592j78l7ir1unr3v5orbvc7ri1eu5.apps.googleusercontent.com';
  const REDIRECT_URI = 'https://youtube-playlist-sorter.vercel.app';
  const SCOPE = 'https://www.googleapis.com/auth/youtube.readonly';
  const RESPONSE_TYPE = 'token';
  const isIOS = /iPad|iPhone|iPod/.test(navigator.userAgent);

  // Auto-logout when idle (no user activity + no recent playback progress)
  const INACTIVITY_LIMIT_MS = 15 * 60 * 1000; // 15 min
  const INACTIVITY_CHECK_MS = 10 * 1000;      // every 10s
  const PLAYBACK_RECENT_MS = 30 * 1000;       // if progress moved in last 30s, treat as active

  // ===== State & refs =====
  const [isLoggedIn, setIsLoggedIn] = useState(false);
  const [token, setToken] = useState('');
  const [playlists, setPlaylists] = useState([]);
  const [selectedPlaylist, setSelectedPlaylist] = useState(null);
  const [playlistVideos, setPlaylistVideos] = useState([]);
  const [allPlaylistVideos, setAllPlaylistVideos] = useState([]);
  const [personalViews, setPersonalViews] = useState(() => {
    try { return JSON.parse(localStorage.getItem('personalViews')) || {}; } catch { return {}; }
  });
  const [showSettings, setShowSettings] = useState(false);
  const [activeTab, setActiveTab] = useState('general');
  const [theme, setTheme] = useState(() => localStorage.getItem('theme') || 'light');
  const [sortType, setSortType] = useState('');
  const [sortDirection, setSortDirection] = useState('desc');
  const [autoPlay, setAutoPlay] = useState(false);
  const [currentIndex, setCurrentIndex] = useState(null);
  const [currentVideoId, setCurrentVideoId] = useState(null);
  const [volume, setVolume] = useState(50);
  const [lowPowerMode, setLowPowerMode] = useState(() => localStorage.getItem('lowPowerMode') === 'true');
  const [iosPrompted, setIosPrompted] = useState(false);
  const [favorites, setFavorites] = useState(() => JSON.parse(localStorage.getItem('favorites')) || []);
  const [showFavorites, setShowFavorites] = useState(false);
  const [loopWindow, setLoopWindow] = useState(true); // show only next 10 from current
  const [searchQuery, setSearchQuery] = useState(''); // single source of truth
  const [fullLimit, setFullLimit] = useState(10);     // "Load more" for full list mode

  const playerRef = useRef(null);

  // Inactivity + playback tracking
  const lastActiveRef = useRef(Date.now());
  const lastPlaybackTickRef = useRef(0);  // last time we saw currentTime change
  const lastTimeRef = useRef(0);          // last currentTime value
  const isPlayingRef = useRef(false);
  const progressIntervalRef = useRef(null);
  const countedThisPlayRef = useRef(false); // did we already count this video in current play?
  const idleIntervalRef = useRef(null);

  // OAuth CSRF state
  const STATE_KEY = 'oauth_state';
  const randomState = () =>
    Array.from(window.crypto.getRandomValues(new Uint8Array(16)))
      .map(b => b.toString(16).padStart(2, '0'))
      .join('');

  // ===== Fetch wrapper =====
  async function ytFetch(url, accessToken) {
    const res = await fetch(url, { headers: { Authorization: `Bearer ${accessToken}` } });
    if (!res.ok) {
      const text = await res.text().catch(() => '');
      if (res.status === 401) {
        alert('Your session expired. Please sign in again.');
        await safeLogout();
        throw new Error('Unauthorized');
      }
      if (res.status === 403) {
        console.error('403 Forbidden/Quota issue:', text);
        alert('YouTube API quota or permission issue.');
      }
      throw new Error(`YouTube API error ${res.status}: ${text}`);
    }
    return res.json();
  }

  // ===== Utilities =====
  const shuffleArray = (arr) => {
    const a = [...arr];
    for (let i = a.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [a[i], a[j]] = [a[j], a[i]];
    }
    return a;
  };

  const handleShuffle = () => {
    const shuffled = shuffleArray(allPlaylistVideos);
    setPlaylistVideos(shuffled);
    setCurrentIndex(0);
    setCurrentVideoId(shuffled[0]?.snippet?.resourceId?.videoId || null);
  };

  // *** Apply theme + low-power ONLY when logged in ***
  useEffect(() => {
    const activeTheme = isLoggedIn ? theme : 'light'; // force light on login screen
    const lpm = isLoggedIn && lowPowerMode;          // only honor LPM when logged in
    document.body.className = activeTheme + (lpm ? ' low-power' : '');

    // keep prefs persisted for next session
    localStorage.setItem('theme', theme);
    localStorage.setItem('lowPowerMode', String(lowPowerMode));
  }, [theme, lowPowerMode, isLoggedIn]);

  useEffect(() => {
    localStorage.setItem('personalViews', JSON.stringify(personalViews));
  }, [personalViews]);

  useEffect(() => {
    localStorage.setItem('favorites', JSON.stringify(favorites));
  }, [favorites]);

  // ===== OAuth parse + scrub URL =====
  useEffect(() => {
    const hash = window.location.hash;
    if (hash) {
      const params = new URLSearchParams(hash.replace('#', '?'));
      const accessToken = params.get('access_token');
      const expiresIn = Number(params.get('expires_in') || '0');
      const stateReturned = params.get('state');

      // scrub token from address bar immediately
      window.history.replaceState(
        {},
        document.title,
        window.location.pathname + window.location.search
      );

      // CSRF check
      const expectedState = sessionStorage.getItem(STATE_KEY);
      sessionStorage.removeItem(STATE_KEY);
      if (expectedState && stateReturned && stateReturned !== expectedState) {
        console.error('OAuth state mismatch. Aborting login.');
        return;
      }

      if (accessToken) {
        setToken(accessToken);
        setIsLoggedIn(true);
        fetchPlaylists(accessToken);

        // pre-logout when token about to expire
        if (expiresIn > 0) {
          const warnMs = Math.max(0, (expiresIn - 60) * 1000);
          setTimeout(() => {
            alert('Session expired—please sign in again.');
            safeLogout();
          }, warnMs);
        }
      }
    }
  }, []);

  // ===== Login / Logout =====
  const handleLogin = () => {
    const state = randomState();
    sessionStorage.setItem(STATE_KEY, state);
    const authUrl =
      `https://accounts.google.com/o/oauth2/v2/auth?client_id=${encodeURIComponent(CLIENT_ID)}` +
      `&redirect_uri=${encodeURIComponent(REDIRECT_URI)}` +
      `&scope=${encodeURIComponent(SCOPE)}` +
      `&response_type=${encodeURIComponent(RESPONSE_TYPE)}` +
      `&include_granted_scopes=true` +
      `&state=${encodeURIComponent(state)}`;
    window.location.href = authUrl;
  };

  const safeLogout = async () => {
    try {
      if (token) {
        await fetch('https://oauth2.googleapis.com/revoke', {
          method: 'POST',
          headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
          body: `token=${encodeURIComponent(token)}`
        });
      }
    } catch (e) {
      console.warn('Token revoke failed (continuing logout):', e);
    }
    setToken('');
    setIsLoggedIn(false);
    setPlaylists([]);
    setSelectedPlaylist(null);
    setPlaylistVideos([]);
    setAllPlaylistVideos([]);
    setCurrentIndex(null);
    setCurrentVideoId(null);
    // KEEP personalViews and favorites across logout:
    // setFavorites([]) → removed
    // localStorage.removeItem('favorites') → removed
    // localStorage.removeItem('personalViews') → removed

    // Reset low-power and force light theme visually right away
    setLowPowerMode(false);
    localStorage.setItem('lowPowerMode', 'false');
    document.body.classList.remove('low-power');
    document.body.classList.remove('dark', 'dracula', 'nord', 'solarized', 'synthwave', 'sepia', 'high-contrast');
    document.body.classList.add('light');

    // hard refresh back to login page (clean)
    window.location.replace(REDIRECT_URI);
  };

  const handleLogout = async () => {
    if (window.confirm('Are you sure you want to log out?')) {
      await safeLogout();
    }
  };

  // ===== Data fetching =====
  const fetchPlaylists = async (accessToken) => {
    const data = await ytFetch(
      'https://www.googleapis.com/youtube/v3/playlists?part=snippet,contentDetails&mine=true&maxResults=50',
      accessToken
    );
    setPlaylists(data.items || []);
  };

  const fetchPlaylistVideos = async (playlist, pageToken = '', accumulated = []) => {
    const data = await ytFetch(
      `https://www.googleapis.com/youtube/v3/playlistItems?part=snippet,contentDetails` +
      `&maxResults=50&playlistId=${playlist.id}` +
      (pageToken ? `&pageToken=${pageToken}` : ''),
      token
    );
    const combined = [...accumulated, ...(data.items || [])];
    if (data.nextPageToken) {
      return fetchPlaylistVideos(playlist, data.nextPageToken, combined);
    }
    setSelectedPlaylist(playlist);
    setAllPlaylistVideos(combined);
    const sorted = sortVideos(combined, sortType, sortDirection);
    setPlaylistVideos(sorted);
    setCurrentIndex(0);
    setCurrentVideoId(sorted[0]?.snippet?.resourceId?.videoId || null);
    markActivity();
    resetPlaybackCounters();
  };

  // ===== Sorting & list logic =====
  const sortVideos = (videos, type, direction) => {
    const factor = direction === 'asc' ? 1 : -1;
    const sorted = [...videos];
    if (type === 'title') {
      sorted.sort((a, b) => a.snippet.title.localeCompare(b.snippet.title) * factor);
    } else if (type === 'views') {
      sorted.sort((a, b) =>
        ((personalViews[b.snippet.resourceId.videoId] || 0) -
         (personalViews[a.snippet.resourceId.videoId] || 0)) * factor
      );
    } else if (type === 'dateAdded') {
      sorted.sort((a, b) =>
        (new Date(a.snippet.publishedAt) - new Date(b.snippet.publishedAt)) * factor
      );
    } else if (type === 'datePublished') {
      sorted.sort((a, b) =>
        (new Date(a.contentDetails.videoPublishedAt) - new Date(b.contentDetails.videoPublishedAt)) * factor
      );
    }
    return sorted;
  };

  // Reset full list limit when view changes
  useEffect(() => {
    setFullLimit(10);
  }, [selectedPlaylist, loopWindow, searchQuery, showFavorites, sortType, sortDirection]);

  // Search setter that also counts as activity
  const setSearchQuerySafe = (v) => { setSearchQuery(v); markActivity(); };

  // Filter by search/favorites
  const baseFiltered = React.useMemo(() => {
    return playlistVideos.filter(video => {
      const id = video.snippet.resourceId.videoId;
      const matchSearch = video.snippet.title.toLowerCase().includes(searchQuery.toLowerCase());
      const matchFav = !showFavorites || favorites.includes(id);
      return matchSearch && matchFav;
    });
  }, [playlistVideos, searchQuery, showFavorites, favorites]);

  // Unplayed first, then played
  const orderByPlayed = (videos) => {
    const unplayed = [];
    const played = [];
    for (const v of videos) {
      const id = v.snippet.resourceId.videoId;
      if (personalViews[id]) played.push(v);
      else unplayed.push(v);
    }
    return [...unplayed, ...played];
  };
  const orderedFiltered = React.useMemo(
    () => orderByPlayed(baseFiltered),
    [baseFiltered, personalViews]
  );

  const indexIn = (arr, vid) => arr.findIndex(v => v.snippet.resourceId.videoId === vid);
  const rotateFrom = (arr, startIndex) => (arr.length ? arr.slice(startIndex).concat(arr.slice(0, startIndex)) : arr);

  const currentIdxInOrdered = indexIn(orderedFiltered, currentVideoId);

  // Display list:
  // - Next 10 mode (loopWindow=true): rotate so current is first, then slice(0,10)
  // - Full list mode: show first `fullLimit` items; "Load more" adds +10
  const displayList = React.useMemo(() => {
    if (!orderedFiltered.length) return [];
    if (loopWindow) {
      const start = currentIdxInOrdered >= 0 ? currentIdxInOrdered : 0;
      const rotated = rotateFrom(orderedFiltered, start);
      return rotated.slice(0, 10);
    }
    return orderedFiltered.slice(0, fullLimit);
  }, [orderedFiltered, loopWindow, currentIdxInOrdered, fullLimit]);

  // ===== Navigation (wrap-around) =====
  const getOrderedForNav = () => {
    const list = orderedFiltered;
    if (!list.length) return { list, ci: -1 };
    let ci = indexIn(list, currentVideoId);
    if (ci < 0) ci = 0;
    return { list, ci };
  };

  const goNext = () => {
    const { list, ci } = getOrderedForNav();
    if (!list.length) return;
    const next = list[(ci + 1) % list.length];
    if (!next) return;
    const nextId = next.snippet.resourceId.videoId;
    setCurrentVideoId(nextId);
    const fullIdx = playlistVideos.findIndex(v => v.snippet.resourceId.videoId === nextId);
    if (fullIdx !== -1) setCurrentIndex(fullIdx);
    markActivity();
    resetPlaybackCounters();
  };

  const goPrev = () => {
    const { list, ci } = getOrderedForNav();
    if (!list.length) return;
    const prev = list[(ci - 1 + list.length) % list.length];
    if (!prev) return;
    const prevId = prev.snippet.resourceId.videoId;
    setCurrentVideoId(prevId);
    const fullIdx = playlistVideos.findIndex(v => v.snippet.resourceId.videoId === prevId);
    if (fullIdx !== -1) setCurrentIndex(fullIdx);
    markActivity();
    resetPlaybackCounters();
  };

  const handleVideoClick = index => {
    const video = displayList[index];
    if (!video) return;
    const id = video.snippet.resourceId.videoId;
    setCurrentVideoId(id);
    const fullIndex = playlistVideos.findIndex(v => v.snippet.resourceId.videoId === id);
    if (fullIndex !== -1) setCurrentIndex(fullIndex);
    markActivity();
    resetPlaybackCounters();
  };

  const incrementPersonalViewOnce = (videoId) => {
    if (!videoId) return;
    if (countedThisPlayRef.current) return; // already counted this playthrough
    countedThisPlayRef.current = true;
    setPersonalViews(prev => ({
      ...prev,
      [videoId]: (prev[videoId] || 0) + 1
    }));
  };

  const handleVideoEnd = () => {
    if (!currentVideoId) return;
    // If we never hit 60% threshold, count on end
    if (!countedThisPlayRef.current) {
      incrementPersonalViewOnce(currentVideoId);
    }
    if (autoPlay) goNext();
  };

  // ===== Inactivity + playback polling =====
  const markActivity = () => { lastActiveRef.current = Date.now(); };

  const resetPlaybackCounters = () => {
    countedThisPlayRef.current = false;
    lastTimeRef.current = 0;
    lastPlaybackTickRef.current = 0;
  };

  const startProgressPolling = () => {
    stopProgressPolling();
    progressIntervalRef.current = setInterval(() => {
      const p = playerRef.current;
      if (!p) return;
      try {
        const state = p.getPlayerState?.();
        // Treat playing & buffering as active
        if (state === 1 || state === 3) {
          isPlayingRef.current = true;
        } else if (state === 2 || state === 0) {
          // paused or ended
          isPlayingRef.current = false;
        }

        const cur = typeof p.getCurrentTime === 'function' ? p.getCurrentTime() : 0;
        const dur = typeof p.getDuration === 'function' ? p.getDuration() : 0;

        // If time advanced, mark playback activity
        if (cur && cur !== lastTimeRef.current) {
          lastPlaybackTickRef.current = Date.now();
          lastTimeRef.current = cur;
          markActivity();
        }

        // 60% watched threshold → count once
        if (!countedThisPlayRef.current && dur > 0 && cur / dur >= 0.6) {
          incrementPersonalViewOnce(currentVideoId);
        }
      } catch (e) {
        // Some browsers can throw if player not ready; ignore
      }
    }, 2000);
  };

  const stopProgressPolling = () => {
    if (progressIntervalRef.current) {
      clearInterval(progressIntervalRef.current);
      progressIntervalRef.current = null;
    }
  };

  useEffect(() => {
    // user interaction events
    const events = ['click', 'mousemove', 'keydown', 'touchstart', 'scroll'];
    const onAnyActivity = () => markActivity();
    events.forEach(ev => window.addEventListener(ev, onAnyActivity, { passive: true }));
    document.addEventListener('visibilitychange', () => {
      if (!document.hidden) markActivity();
    });

    // periodic idle check
    idleIntervalRef.current = setInterval(async () => {
      const now = Date.now();
      const idleMs = now - lastActiveRef.current;
      const sincePlaybackMs = now - (lastPlaybackTickRef.current || 0);
      const playbackRecentlyActive = isPlayingRef.current || (sincePlaybackMs <= PLAYBACK_RECENT_MS);

      if (!isLoggedIn) return; // only enforce while logged in

      if (!playbackRecentlyActive && idleMs >= INACTIVITY_LIMIT_MS) {
        await safeLogout(); // includes hard redirect
      }
    }, INACTIVITY_CHECK_MS);

    return () => {
      events.forEach(ev => window.removeEventListener(ev, onAnyActivity));
      if (idleIntervalRef.current) clearInterval(idleIntervalRef.current);
      stopProgressPolling();
    };
  }, [isLoggedIn]); // re-evaluate if login status changes

  // Track player state
  const onPlayerStateChange = (e) => {
    const st = e.data;
    if (st === 1 || st === 3) { // playing or buffering
      isPlayingRef.current = true;
      markActivity();
    } else {
      isPlayingRef.current = false;
    }
  };

  // Start/stop polling when player becomes ready
  const onPlayerReady = (e) => {
    playerRef.current = e.target;
    playerRef.current.setVolume(volume);
    markActivity();
    startProgressPolling();
  };

  // Also restart polling when current video changes
  useEffect(() => {
    if (playerRef.current && currentVideoId) {
      resetPlaybackCounters();
      startProgressPolling();
    }
  }, [currentVideoId]);

  // === BrandBar (sticky top-left logo — hidden on login) ===
  const goHome = () => {
    setSelectedPlaylist(null);
    setPlaylistVideos([]);
    setAllPlaylistVideos([]);
    setCurrentIndex(null);
    setCurrentVideoId(null);
    setIosPrompted(false);
    resetPlaybackCounters();
  };

  const BrandBar = () => {
    return (
      <div
        style={{
          position: 'sticky',
          top: 0,
          zIndex: 1000,
          width: '100%',
          display: 'flex',
          alignItems: 'center',
          gap: 14,
          padding: '10px 14px',
          background: 'var(--header-bg)',
          color: 'var(--header-fg)',
          borderBottom: '1px solid var(--header-border)'
        }}
      >
        <img
          src="/ytps-logo.png"
          alt="YouTube Playlist Sorter"
          width={40}
          height={40}
          style={{ borderRadius: 8, cursor: 'pointer' }}
          onClick={goHome}
        />
        <button
          onClick={goHome}
          style={{
            background: 'transparent',
            border: 0,
            color: 'var(--header-fg)',
            fontWeight: 600,
            letterSpacing: 0.2,
            cursor: 'pointer'
          }}
          title="Go to Playlists"
        >
          YouTube Playlist Sorter
        </button>
      </div>
    );
  };

  return (
    <>
      {/* Show sticky header only after login */}
      {isLoggedIn && <BrandBar />}

      <div className={`app-container ${isLoggedIn ? theme : 'light'}`} style={{ display: 'flex' }}>
        {/* Main content */}
        <div style={{
          flex: 1,
          textAlign: 'center',
          display: 'flex',
          flexDirection: 'column',
          alignItems: 'center'
        }}>
          {!isLoggedIn ? (
            // Login screen — logo above button, no extra title text
            <div style={{ marginTop: '10vh', textAlign: 'center' }}>
              <img
                src="/ytps-logo.png"
                alt="YouTube Playlist Sorter logo"
                width={120}
                height={120}
                style={{ display: 'block', margin: '0 auto 16px', borderRadius: 16 }}
              />
              <button
                onClick={handleLogin}
                className="primary"
                style={{ fontSize: '1.2em', padding: '10px 20px' }}
              >
                Log in with Google
              </button>

              <p style={{ marginTop: '12px' }}>
                <a href="/privacy.html">Privacy Policy</a> |{' '}
                <a href="/terms.html">Terms and Conditions</a>
              </p>
            </div>
          ) : selectedPlaylist ? (
            // Video player + list view
            <div style={{ width: '100%', maxWidth: '900px' }}>
              {/* Use top-left logo/name to go home */}
              <h2>{selectedPlaylist.snippet.title}</h2>

              {/* iOS autoplay prompt */}
              {!iosPrompted && isIOS && autoPlay && displayList.length > 0 && (
                <button
                  onClick={() => {
                    setIosPrompted(true);
                    setCurrentVideoId(displayList[0].snippet.resourceId.videoId);
                  }}
                  style={{ margin: '1em 0' }}
                >
                  ▶ Start Watching
                </button>
              )}

              {/* YouTube player (wrapped in boundary) */}
              <ErrorBoundary>
                {(!isIOS || iosPrompted || !autoPlay) && currentVideoId && (
                  <YouTube
                    videoId={currentVideoId}
                    opts={{ playerVars: { autoplay: 1, controls: 1 } }}
                    onReady={onPlayerReady}
                    onStateChange={onPlayerStateChange}
                    onEnd={handleVideoEnd}
                  />
                )}
              </ErrorBoundary>

              {/* Controls */}
              <div style={{ margin: '10px 0' }}>
                <button onClick={goPrev}>Previous</button>
                <button onClick={goNext} style={{ marginLeft: '10px' }}>
                  Next
                </button>
                <input
                  type="range"
                  min="0"
                  max="100"
                  value={volume}
                  onChange={e => {
                    const v = +e.target.value;
                    setVolume(v);
                    if (playerRef.current) playerRef.current.setVolume(v);
                    markActivity();
                  }}
                  style={{ marginLeft: '10px' }}
                />
              </div>

              {/* Filters & sorting with Shuffle */}
              <div style={{ margin: '1em 0' }}>
                <label>Sort by: </label>
                <select
                  value={sortType}
                  onChange={e => {
                    setSortType(e.target.value);
                    setPlaylistVideos(sortVideos(allPlaylistVideos, e.target.value, sortDirection));
                    markActivity();
                  }}
                >
                  <option value="">None</option>
                  <option value="title">Title</option>
                  <option value="views">Personal Views</option>
                  <option value="dateAdded">Date Added</option>
                  <option value="datePublished">Date Published</option>
                </select>
                <button
                  onClick={() => {
                    setSortDirection(d => (d === 'asc' ? 'desc' : 'asc'));
                    setPlaylistVideos(sortVideos(
                      allPlaylistVideos,
                      sortType,
                      sortDirection === 'asc' ? 'desc' : 'asc'
                    ));
                    markActivity();
                  }}
                  style={{ marginLeft: '10px' }}
                >
                  {sortDirection === 'asc' ? 'Ascending' : 'Descending'}
                </button>
                <button onClick={() => { handleShuffle(); markActivity(); }} style={{ marginLeft: '10px' }}>
                  Shuffle
                </button>
                <input
                  type="text"
                  placeholder="Search videos…"
                  value={searchQuery}
                  onChange={e => setSearchQuerySafe(e.target.value)}
                  style={{ margin: '0 10px' }}
                />
                <button onClick={() => { setShowFavorites(f => !f); markActivity(); }}>
                  {showFavorites ? 'Show All' : 'Show Favorites'}
                </button>
                <button
                  onClick={() => { setLoopWindow(w => !w); markActivity(); }}
                  style={{ marginLeft: '10px' }}
                  title="When enabled: shows only the next 10 videos, unplayed first, loops on end."
                >
                  {loopWindow ? 'Show Full List' : 'Show Next 10 (Loop)'}
                </button>
              </div>

              {/* Video list */}
              <ErrorBoundary key={`list-${loopWindow ? 'win' : 'full'}-${fullLimit}`}>
                <ul style={{ listStyle: 'none', padding: 0, margin: 0 }}>
                  {displayList.map((v, i) => {
                    const id = v.snippet.resourceId.videoId;
                    const played = !!personalViews[id];
                    return (
                      <li
                        key={id + '-' + i}
                        onClick={() => handleVideoClick(i)}
                        style={{
                          display: 'flex',
                          alignItems: 'center',
                          padding: '10px',
                          cursor: 'pointer',
                          opacity: played ? 0.75 : 1
                        }}
                      >
                        <span style={{ marginRight: '8px' }}>{i + 1}.</span>
                        <img
                          src={v.snippet.thumbnails?.default?.url}
                          alt="thumb"
                          style={{ width: 80, height: 80, marginRight: 10, objectFit: 'cover' }}
                          loading="lazy"
                        />
                        <div style={{ flex: 1, textAlign: 'left' }}>
                          <strong>{v.snippet.title}</strong>
                          <div>Views: {personalViews[id] || 0}</div>
                        </div>
                        <button
                          onClick={e => {
                            e.stopPropagation();
                            setFavorites(f =>
                              f.includes(id) ? f.filter(x => x !== id) : [...f, id]
                            );
                            markActivity();
                          }}
                          style={{ fontSize: '1.2em' }}
                          title={favorites.includes(id) ? 'Unfavorite' : 'Favorite'}
                        >
                          {favorites.includes(id) ? '★' : '☆'}
                        </button>
                      </li>
                    );
                  })}
                </ul>

                {/* Bottom-right Load more (only in Full List mode and when more exist) */}
                {!loopWindow && fullLimit < orderedFiltered.length && (
                  <div style={{ display: 'flex', justifyContent: 'flex-end', marginTop: 10 }}>
                    <button onClick={() => setFullLimit(l => l + 10)}>
                      Load more (+10)
                    </button>
                  </div>
                )}
              </ErrorBoundary>
            </div>
          ) : (
            // Playlist selection
            <>
              <ul style={{ listStyle: 'none', padding: 0, marginTop: '5vh' }}>
                {playlists.map(pl => (
                  <li
                    key={pl.id}
                    onClick={() => fetchPlaylistVideos(pl).catch(console.error)}
                    style={{
                      display: 'flex',
                      alignItems: 'center',
                      cursor: 'pointer',
                      marginBottom: '1.5em'
                    }}
                  >
                    <div style={{ position: 'relative', display: 'inline-block' }}>
                      <img
                        src={pl.snippet.thumbnails?.default?.url}
                        alt="thumbnail"
                        style={{ width: '100px', height: '100px', marginRight: '10px' }}
                      />
                      <span style={{
                        position: 'absolute', top: '5px', right: '5px',
                        background: 'rgba(0,0,0,0.7)', color: '#fff',
                        padding: '2px 5px', borderRadius: '3px', fontSize: '0.8em'
                      }}>
                        {pl.contentDetails.itemCount}
                      </span>
                    </div>
                    <div style={{ flex: 1, textAlign: 'left' }}>
                      <strong>{pl.snippet.title}</strong>
                    </div>
                  </li>
                ))}
              </ul>
            </>
          )}
        </div>

        {/* Settings drawer */}
        {isLoggedIn && (
          <div className="settings-drawer" style={{
            width: '300px',
            padding: '20px',
            position: 'sticky',
            top: '10vh'
          }}>
            <button
              onClick={() => setShowSettings(s => !s)}
              style={{ marginBottom: '10px' }}
            >
              ⚙️ Settings
            </button>
            {showSettings && (
              <div className="settings">
                <div className="tab-buttons">
                  <button onClick={() => setActiveTab('general')}>
                    General
                  </button>
                  <button onClick={() => setActiveTab('theme')}>
                    Theme
                  </button>
                </div>

                {activeTab === 'general' && (
                  <>
                    <button
                      onClick={() => setAutoPlay(a => !a)}
                      style={{ display: 'block', margin: '10px 0' }}
                    >
                      {autoPlay ? 'Disable Autoplay' : 'Enable Autoplay'}
                    </button>
                    <button
                      onClick={() => setLoopWindow(w => !w)}
                      style={{ display: 'block', margin: '10px 0' }}
                      title="When enabled: shows only the next 10 videos, unplayed first, loops on end."
                    >
                      {loopWindow ? 'Show Full List' : 'Show Next 10 (Loop)'}
                    </button>
                    <button
                      onClick={() => {
                        setPersonalViews({});
                        localStorage.removeItem('personalViews');
                      }}
                      style={{ display: 'block', margin: '10px 0' }}
                    >
                      Reset Personal Views
                    </button>
                    <hr style={{ margin: '12px 0', opacity: 0.3 }} />
                    <button
                      onClick={handleLogout}
                      style={{
                        display: 'block',
                        margin: '10px 0',
                        background: 'var(--accent)',
                        color: 'var(--accent-contrast)',
                        border: 'none',
                        padding: '8px 12px',
                        borderRadius: 6,
                        cursor: 'pointer'
                      }}
                      title="Sign out of Google and return to the login screen"
                    >
                      Log Out
                    </button>
                  </>
                )}

                {activeTab === 'theme' && (
                  <>
                    <label style={{ display: 'block', margin: '10px 0 6px' }}>Theme</label>
                    <select
                      value={theme}
                      onChange={e => setTheme(e.target.value)}
                      style={{ display: 'block', width: '100%', padding: '8px', marginBottom: '12px' }}
                    >
                      <option value="light">Light</option>
                      <option value="dark">Dark</option>
                      <option value="dracula">Dracula</option>
                      <option value="nord">Nord</option>
                      <option value="solarized">Solarized</option>
                      <option value="synthwave">Synthwave</option>
                      <option value="sepia">Sepia</option>
                      <option value="high-contrast">High Contrast</option>
                    </select>

                    <button
                      onClick={() => setLowPowerMode(l => !l)}
                      style={{ display: 'block', margin: '10px 0' }}
                    >
                      {lowPowerMode ? 'Disable Low Power Mode' : 'Enable Low Power Mode'}
                    </button>
                  </>
                )}
              </div>
            )}
          </div>
        )}
      </div>
    </>
  );
}

export default App;
