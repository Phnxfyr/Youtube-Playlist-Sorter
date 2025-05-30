import React, { useState, useEffect, useRef } from 'react';
import YouTube from 'react-youtube';
import './App.css';
import './theme.css';

function App() {
  // State & refs
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
  const [searchQuery, setSearchQuery] = useState('');
  const [favorites, setFavorites] = useState(() => JSON.parse(localStorage.getItem('favorites')) || []);
  const [showFavorites, setShowFavorites] = useState(false);
  const [hidePlayed, setHidePlayed] = useState(true);
  const playerRef = useRef(null);

  const CLIENT_ID = '53619685564-bbu592j78l7ir1unr3v5orbvc7ri1eu5.apps.googleusercontent.com';
  const REDIRECT_URI = 'https://youtube-playlist-sorter.vercel.app';
  const SCOPE = 'https://www.googleapis.com/auth/youtube.readonly';
  const RESPONSE_TYPE = 'token';
  const isIOS = /iPad|iPhone|iPod/.test(navigator.userAgent);

  // Load saved data
  useEffect(() => {
    const savedViews = localStorage.getItem('personalViews');
    if (savedViews) setPersonalViews(JSON.parse(savedViews));
    const savedTheme = localStorage.getItem('theme');
    if (savedTheme) setTheme(savedTheme);
  }, []);

  useEffect(() => {
    document.body.className = theme + (lowPowerMode ? ' low-power' : '');
    localStorage.setItem('theme', theme);
    localStorage.setItem('lowPowerMode', lowPowerMode);
  }, [theme, lowPowerMode]);

  useEffect(() => {
    localStorage.setItem('personalViews', JSON.stringify(personalViews));
  }, [personalViews]);

  useEffect(() => {
    localStorage.setItem('favorites', JSON.stringify(favorites));
  }, [favorites]);

  // OAuth callback
  useEffect(() => {
    const hash = window.location.hash;
    if (hash) {
      const params = new URLSearchParams(hash.replace('#', '?'));
      const accessToken = params.get('access_token');
      if (accessToken) {
        setToken(accessToken);
        setIsLoggedIn(true);
        fetchPlaylists(accessToken);
      }
    }
  }, []);

  // Handlers
  const handleLogin = () => {
    const authUrl = `https://accounts.google.com/o/oauth2/v2/auth?client_id=${CLIENT_ID}` +
      `&redirect_uri=${REDIRECT_URI}&scope=${SCOPE}&response_type=${RESPONSE_TYPE}` +
      `&include_granted_scopes=true`;
    window.location.href = authUrl;
  };

  const handleLogout = () => {
    if (window.confirm('Are you sure you want to log out?')) {
      setToken('');
      setIsLoggedIn(false);
      setPlaylists([]);
      setSelectedPlaylist(null);
      setPlaylistVideos([]);
      setAllPlaylistVideos([]);
      setCurrentIndex(null);
      setCurrentVideoId(null);
      window.location.hash = '';
    }
  };

  // Fetch playlists (with contentDetails for itemCount)
  const fetchPlaylists = async (accessToken) => {
    const res = await fetch(
      'https://www.googleapis.com/youtube/v3/playlists?part=snippet,contentDetails&mine=true&maxResults=50',
      { headers: { Authorization: `Bearer ${accessToken}` } }
    );
    const data = await res.json();
    setPlaylists(data.items || []);
  };

  // Recursively fetch all videos in a playlist
  const fetchPlaylistVideos = async (playlist, pageToken = '', accumulated = []) => {
    const res = await fetch(
      `https://www.googleapis.com/youtube/v3/playlistItems?part=snippet,contentDetails` +
      `&maxResults=50&playlistId=${playlist.id}&pageToken=${pageToken}`,
      { headers: { Authorization: `Bearer ${token}` } }
    );
    const data = await res.json();
    const combined = [...accumulated, ...(data.items || [])];
    if (data.nextPageToken) {
      return fetchPlaylistVideos(playlist, data.nextPageToken, combined);
    }
    setSelectedPlaylist(playlist);
    setAllPlaylistVideos(combined);
    const sorted = sortVideos(combined, sortType, sortDirection);
    setPlaylistVideos(sorted);
    setCurrentIndex(0);
    setCurrentVideoId(sorted[0]?.snippet.resourceId.videoId || null);
  };

  // Sorting helper
  const sortVideos = (videos, type, direction) => {
    const factor = direction === 'asc' ? 1 : -1;
    const sorted = [...videos];
    if (type === 'title') {
      sorted.sort((a, b) => a.snippet.title.localeCompare(b.snippet.title) * factor);
    } else if (type === 'views') {
      sorted.sort((a, b) => ((personalViews[b.snippet.resourceId.videoId] || 0)
        - (personalViews[a.snippet.resourceId.videoId] || 0)) * factor);
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

  // Filtered view for search / favorites / hide-played
  const filteredVideos = playlistVideos.filter(video => {
    const id = video.snippet.resourceId.videoId;
    const matchSearch = video.snippet.title.toLowerCase().includes(searchQuery.toLowerCase());
    const matchFav = !showFavorites || favorites.includes(id);
    const matchPlayed = !hidePlayed || !personalViews[id];
    return matchSearch && matchFav && matchPlayed;
  });

  // Clicking on a list item maps from filtered → full index
  const handleVideoClick = index => {
    const video = filteredVideos[index];
    if (!video) return;
    const fullIndex = playlistVideos.findIndex(
      v => v.snippet.resourceId.videoId === video.snippet.resourceId.videoId
    );
    if (fullIndex !== -1) {
      setCurrentIndex(fullIndex);
      setCurrentVideoId(video.snippet.resourceId.videoId);
    }
  };

  // When a video ends, count personal view and optionally autoplay next
  const handleVideoEnd = () => {
    if (!currentVideoId) return;
    setPersonalViews(prev => ({
      ...prev,
      [currentVideoId]: (prev[currentVideoId] || 0) + 1
    }));
    if (autoPlay && currentIndex != null && currentIndex + 1 < playlistVideos.length) {
      const next = currentIndex + 1;
      setCurrentIndex(next);
      setCurrentVideoId(playlistVideos[next].snippet.resourceId.videoId);
    }
  };

  return (
    <div className={`app-container ${theme}`} style={{ display: 'flex' }}>
      {/* Main content */}
      <div style={{
        flex: 1, textAlign: 'center',
        display: 'flex', flexDirection: 'column', alignItems: 'center'
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
            {!iosPrompted && isIOS && autoPlay && playlistVideos.length > 0 && (
              <button
                onClick={() => {
                  setIosPrompted(true);
                  setCurrentVideoId(playlistVideos[0].snippet.resourceId.videoId);
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
                }}
                onEnd={handleVideoEnd}
              />
            )}

            {/* Controls */}
            <div style={{ margin: '10px 0' }}>
              <button onClick={() => handleVideoClick(currentIndex - 1)}>
                Previous
              </button>
              <button
                onClick={() => handleVideoClick(currentIndex + 1)}
                style={{ marginLeft: '10px' }}
              >
                Next
              </button>
              <input
                type="range"
                min="0" max="100"
                value={volume}
                onChange={e => {
                  const v = +e.target.value;
                  setVolume(v);
                  if (playerRef.current) playerRef.current.setVolume(v);
                }}
                style={{ marginLeft: '10px' }}
              />
            </div>

            {/* Filters & sorting */}
            <div style={{ margin: '1em 0' }}>
              <label>Sort by: </label>
              <select
                value={sortType}
                onChange={e => {
                  setSortType(e.target.value);
                  setPlaylistVideos(sortVideos(allPlaylistVideos, e.target.value, sortDirection));
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
                  setSortDirection(d => d === 'asc' ? 'desc' : 'asc');
                  setPlaylistVideos(sortVideos(allPlaylistVideos, sortType, sortDirection === 'asc' ? 'desc' : 'asc'));
                }}
                style={{ marginLeft: '10px' }}
              >
                {sortDirection === 'asc' ? 'Ascending' : 'Descending'}
              </button>
              <input
                type="text"
                placeholder="Search videos…"
                value={searchQuery}
                onChange={e => setSearchQuery(e.target.value)}
                style={{ margin: '0 10px' }}
              />
              <button onClick={() => setShowFavorites(f => !f)}>
                {showFavorites ? 'Show All' : 'Show Favorites'}
              </button>
              <button onClick={() => setHidePlayed(h => !h)} style={{ marginLeft: '10px' }}>
                {hidePlayed ? 'Show Played' : 'Hide Played'}
              </button>
            </div>

            {/* Video list */}
            <ul style={{ listStyle: 'none', padding: 0 }}>
              {filteredVideos.map((v, i) => {
                const id = v.snippet.resourceId.videoId;
                return (
                  <li
                    key={id}
                    onClick={() => handleVideoClick(i)}
                    style={{
                      display: 'flex',
                      alignItems: 'center',
                      padding: '10px',
                      cursor: 'pointer'
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
                        setFavorites(f => f.includes(id) ? f.filter(x => x !== id) : [...f, id]);
                      }}
                      style={{ fontSize: '1.2em' }}
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
                  onClick={() => fetchPlaylistVideos(pl)}
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
                  <strong>{pl.snippet.title}</strong>
                </li>
              ))}
            </ul>
          </>
        )}
      </div>

      {/* Settings drawer */}
      {isLoggedIn && (
        <div style={{
          width: '300px', padding: '20px',
          position: 'sticky', top: '10vh'
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
                    onClick={() => setHidePlayed(h => !h)}
                    style={{ display: 'block', margin: '10px 0' }}
                  >
                    {hidePlayed ? 'Show Played Songs' : 'Hide Played Songs'}
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
                </>
              )}
              {activeTab === 'theme' && (<> 
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
              </>)}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

export default App;
