import React, { useState, useEffect, useRef } from 'react';
import YouTube from 'react-youtube';
import './App.css';
import './theme.css';

function App() {
  // ===== Config =====
  const CLIENT_ID = '53619685564-bbu592j78l7ir1unr3v5orbvc7ri1eu5.apps.googleusercontent.com';
  const REDIRECT_URI = 'https://youtube-playlist-sorter.vercel.app';
  const SCOPE = 'https://www.googleapis.com/auth/youtube.readonly';
  const RESPONSE_TYPE = 'token';
  const isIOS = /iPad|iPhone|iPod/.test(navigator.userAgent);

  // Auto-logout when idle (no user activity + not playing video)
  const INACTIVITY_LIMIT_MS = 15 * 60 * 1000; // 15 minutes
  const INACTIVITY_CHECK_MS = 10 * 1000;      // check every 10s

  // ===== State & refs =====
  const [isLoggedIn, setIsLoggedIn] = useState(false);
  const [token, setToken] = useState('');
  const [playlists, setPlaylists] = useState([]);
  const [selectedPlaylist, setSelectedPlaylist] = useState(null);
  const [playlistVideos, setPlaylistVideos] = useState([]);
  const [allPlaylistVideos, setAllPlaylistVideos] = useState([]);
  const [personalViews, setPersonalViews] = useState({});
  const [showSettings, setShowSettings] = useState(false);
  const [activeTab, setActiveTab] = useState('general');
  const [theme, setTheme] = useState('light');
  const [sortType, setSortType] = useState('');
  const [sortDirection, setSortDirection] = useState('desc');
  const [autoPlay, setAutoPlay] = useState(false);
  const [currentIndex, setCurrentIndex] = useState(null);
  const [currentVideoId, setCurrentVideoId] = useState(null);
  const [volume, setVolume] = useState(50);
  const [lowPowerMode, setLowPowerMode] = useState(false);
  const [iosPrompted, setIosPrompted] = useState(false);
  const [favorites, setFavorites] = useState(() => JSON.parse(localStorage.getItem('favorites')) || []);
  const [showFavorites, setShowFavorites] = useState(false);
  const [loopWindow, setLoopWindow] = useState(true); // show only next 10 from current
  const [searchQuery, setSearchQuery] = useState(''); // <-- single source of truth

  const playerRef = useRef(null);

  // Refs for inactivity logic
  const lastActiveRef = useRef(Date.now());
  const isPlayingRef = useRef(false);
  const idleIntervalRef = useRef(null);

  // OAuth CSRF state
  const STATE_KEY = 'oauth_state';
  const randomState = () =>
    Array.from(crypto.getRandomValues(new Uint8Array(16)))
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

  // ===== Persist simple prefs =====
  useEffect(() => {
    const savedViews = localStorage.getItem('personalViews');
    if (savedViews) setPersonalViews(JSON.parse(savedViews));
    const savedTheme = localStorage.getItem('theme');
    if (savedTheme) setTheme(savedTheme);
    const savedLPM = localStorage.getItem('lowPowerMode');
    if (savedLPM) setLowPowerMode(savedLPM === 'true');
  }, []);

  useEffect(() => {
    document.body.className = theme + (lowPowerMode ? ' low-power' : '');
    localStorage.setItem('theme', theme);
    localStorage.setItem('lowPowerMode', String(lowPowerMode));
  }, [theme, lowPowerMode]);

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
      history.replaceState({}, document.title, location.pathname + location.search);

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
    setFavorites([]);
    localStorage.removeItem('favorites');
    localStorage.removeItem('personalViews');
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
  const displayList = React.useMemo(() => {
    if (!orderedFiltered.length) return [];
    if (!loopWindow) return orderedFiltered;
    const start = currentIdxInOrdered >= 0 ? currentIdxInOrdered : 0;
    const rotated = rotateFrom(orderedFiltered, start);
    return rotated.slice(0, 10); // show next 10
  }, [orderedFiltered, loopWindow, currentIdxInOrdered]);

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
  };

  const handleVideoClick = index => {
    const video = displayList[index];
    if (!video) return;
    const id = video.snippet.resourceId.videoId;
    setCurrentVideoId(id);
    const fullIndex = playlistVideos.findIndex(v => v.snippet.resourceId.videoId === id);
    if (fullIndex !== -1) setCurrentIndex(fullIndex);
    markActivity();
  };

  const handleVideoEnd = () => {
    if (!currentVideoId) return;
    setPersonalViews(prev => ({
      ...prev,
      [currentVideoId]: (prev[currentVideoId] || 0) + 1
    }));
    if (autoPlay) goNext();
  };

  // ===== Inactivity tracking =====
  const markActivity = () => { lastActiveRef.current = Date.now(); };

  useEffect(() => {
    // user interaction events
    const events = ['click', 'mousemove', 'keydown', 'touchstart', 'scroll'];
    const onAnyActivity = () => markActivity();
    events.forEach(ev => window.addEventListener(ev, onAnyActivity, { passive: true }));
    document.addEventListener('visibilitychange', () => {
      if (!document.hidden) markActivity();
    });

    // periodic check
    idleIntervalRef.current = setInterval(async () => {
      const idleMs = Date.now() - lastActiveRef.current;
      if (!isPlayingRef.current && idleMs >= INACTIVITY_LIMIT_MS) {
        // no activity AND not playing → logout + hard refresh
        await safeLogout(); // includes window.location.replace
      }
    }, INACTIVITY_CHECK_MS);

    return () => {
      events.forEach(ev => window.removeEventListener(ev, onAnyActivity));
      if (idleIntervalRef.current) clearInterval(idleIntervalRef.current);
    };
  }, []); // run once

  // Track player state (1=playing, 2=paused, 0=ended, -1=unstarted, 3=buffering)
  const onPlayerStateChange = (e) => {
    const st = e.data;
    if (st === 1) { // playing
      isPlayingRef.current = true;
      markActivity();
    } else {
      isPlayingRef.current = false;
    }
  };

  // Also mark activity when current video changes
  useEffect(() => {
    if (currentVideoId) markActivity();
  }, [currentVideoId]);

  return (
    <div className={`app-container ${theme}`} style={{ display: 'flex' }}>
      {/* Main content */}
      <div style={{
        flex: 1,
        textAlign: 'center',
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center'
      }}>
        {!isLoggedIn ? (
          // Login screen
          <div style={{ marginTop: '20vh' }}>
            <h1 style={{ fontSize: '2em', marginBottom: '1em' }}>
              YouTube Playlist Sorter
            </h1>
            <button
              onClick={handleLogin}
              style={{ fontSize: '1.2em', padding: '10px 20px' }}
            >
              Log in with Google
            </button>
            <p>
              <a href="/privacy.html">Privacy Policy</a> |{' '}
              <a href="/terms.html">Terms and Conditions</a>
            </p>
          </div>
        ) : selectedPlaylist ? (
          // Video player + list view
          <div style={{ width: '100%', maxWidth: '900px' }}>
            <button onClick={() => {
              setSelectedPlaylist(null);
              setPlaylistVideos([]);
              setAllPlaylistVideos([]);
              setCurrentIndex(null);
              setCurrentVideoId(null);
            }}>
              ← Back to Playlists
            </button>
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

            {/* YouTube player */}
            {(!isIOS || iosPrompted || !autoPlay) && currentVideoId && (
              <YouTube
                videoId={currentVideoId}
                opts={{ playerVars: { autoplay: 1, controls: 1 } }}
                onReady={e => {
                  playerRef.current = e.target;
                  playerRef.current.setVolume(volume);
                  markActivity();
                }}
                onStateChange={onPlayerStateChange}
                onEnd={handleVideoEnd}
              />
            )}

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

            {/* Video list (ordered, windowed) */}
            <ul style={{ listStyle: 'none', padding: 0 }}>
              {displayList.map((v, i) => {
                const id = v.snippet.resourceId.videoId;
                const played = !!personalViews[id];
                return (
                  <li
                    key={id}
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
                      src={v.snippet.thumbnails.default.url}
                      alt="thumb"
                      style={{ width: '80px', height: '80px', marginRight: '10px' }}
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
          </div>
        ) : (
          // Playlist selection
          <>
            <button onClick={handleLogout} style={{ margin: '1em 0' }}>
              Log Out
            </button>
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
                      src={pl.snippet.thumbnails.default.url}
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
        <div style={{
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
                  >
                    {loopWindow ? 'Show Full List' : 'Show Next 10 (Loop)'}
                  </button>
                </>
              )}
              {activeTab === 'theme' && (
                <>
                  <button
                    onClick={() => setTheme(t => t === 'light' ? 'dark' : 'light')}
                    style={{ display: 'block', margin: '10px 0' }}
                  >
                    {theme === 'light' ? 'Enable Dark Mode' : 'Enable Light Mode'}
                  </button>
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
  );
}

export default App;
