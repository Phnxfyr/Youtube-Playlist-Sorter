import React, { useState, useEffect, useRef } from 'react';
import YouTube from 'react-youtube';
import './App.css';

function App() {
  const [isLoggedIn, setIsLoggedIn] = useState(false);
  const [token, setToken] = useState('');
  const [playlists, setPlaylists] = useState([]);
  const [selectedPlaylist, setSelectedPlaylist] = useState(null);
  const [playlistVideos, setPlaylistVideos] = useState([]);
  const [allPlaylistVideos, setAllPlaylistVideos] = useState([]);
  const [nextPageToken, setNextPageToken] = useState(null);
  const [personalViews, setPersonalViews] = useState({});
  const [showSettings, setShowSettings] = useState(false);
  const [activeTab, setActiveTab] = useState('general');
  const [theme, setTheme] = useState('light');
  const [sortDirection, setSortDirection] = useState('desc');
  const [sortType, setSortType] = useState('');
  const [showSidebar, setShowSidebar] = useState(() => {
    const saved = localStorage.getItem('showSidebar');
    if (saved !== null) return saved === 'true';
    return window.innerWidth >= 768;
  });
  const [autoPlay, setAutoPlay] = useState(false);
  const [currentIndex, setCurrentIndex] = useState(null);
  const [currentVideoId, setCurrentVideoId] = useState(null);
  const [volume, setVolume] = useState(50);
  const [iosPrompted, setIosPrompted] = useState(() => localStorage.getItem('iosAutoplayAcknowledged') === 'true');

  const loader = useRef(null);
  const playerRef = useRef(null);

  const CLIENT_ID = '53619685564-bbu592j78l7ir1unr3v5orbvc7ri1eu5.apps.googleusercontent.com';
  const REDIRECT_URI = 'https://youtube-playlist-sorter.vercel.app';
  const SCOPE = 'https://www.googleapis.com/auth/youtube.readonly';
  const RESPONSE_TYPE = 'token';

  const isIOS = /iPad|iPhone|iPod/.test(navigator.userAgent);

  useEffect(() => {
    const savedViews = localStorage.getItem('personalViews');
    if (savedViews) setPersonalViews(JSON.parse(savedViews));

    const savedTheme = localStorage.getItem('theme');
    if (savedTheme) setTheme(savedTheme);
  }, []);

  useEffect(() => {
    document.body.className = theme;
    localStorage.setItem('theme', theme);
  }, [theme]);

  useEffect(() => {
    localStorage.setItem('personalViews', JSON.stringify(personalViews));
  }, [personalViews]);

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

  const handleLogin = () => {
    const authUrl = `https://accounts.google.com/o/oauth2/v2/auth?client_id=${CLIENT_ID}&redirect_uri=${REDIRECT_URI}&scope=${SCOPE}&response_type=${RESPONSE_TYPE}&include_granted_scopes=true`;
    window.location.href = authUrl;
  };

  const fetchPlaylists = async (accessToken) => {
    const res = await fetch(
      'https://www.googleapis.com/youtube/v3/playlists?part=snippet&mine=true&maxResults=50',
      {
        headers: {
          Authorization: `Bearer ${accessToken}`,
        },
      }
    );
    const data = await res.json();
    setPlaylists(data.items || []);
  };

  const fetchPlaylistVideos = async (playlist, pageToken = '', accumulated = []) => {
    const res = await fetch(
      `https://www.googleapis.com/youtube/v3/playlistItems?part=snippet&maxResults=50&playlistId=${playlist.id}&pageToken=${pageToken}`,
      {
        headers: {
          Authorization: `Bearer ${token}`,
        },
      }
    );
    const data = await res.json();
    const combined = [...accumulated, ...(data.items || [])];

    if (data.nextPageToken) {
      fetchPlaylistVideos(playlist, data.nextPageToken, combined);
    } else {
      setSelectedPlaylist(playlist);
      setAllPlaylistVideos(combined);
      setNextPageToken(null);

      const finalSorted = sortVideos(combined, sortType, sortDirection);
      setPlaylistVideos(finalSorted);
      setCurrentIndex(0);
      setCurrentVideoId(finalSorted[0]?.snippet.resourceId?.videoId || null);
    }
  };

  const sortVideos = (videos, type, direction) => {
    const factor = direction === 'asc' ? 1 : -1;
    const sorted = [...videos];

    if (type === 'title') {
      sorted.sort((a, b) => a.snippet.title.localeCompare(b.snippet.title) * factor);
    } else if (type === 'views') {
      sorted.sort((a, b) => {
        const vidA = personalViews[a.snippet.resourceId?.videoId] || 0;
        const vidB = personalViews[b.snippet.resourceId?.videoId] || 0;
        return (vidB - vidA) * factor;
      });
    } else if (type === 'dateAdded') {
      sorted.sort((a, b) => (new Date(a.snippet.publishedAt) - new Date(b.snippet.publishedAt)) * factor);
    } else if (type === 'datePublished') {
      sorted.sort((a, b) => (new Date(a.snippet.publishedAt || 0) - new Date(b.snippet.publishedAt || 0)) * factor);
    }

    return sorted;
  };

  const sortPlaylistVideos = (type) => {
    const newDirection = sortType === type ? (sortDirection === 'asc' ? 'desc' : 'asc') : sortDirection;
    setSortDirection(newDirection);
    setSortType(type);

    const sorted = sortVideos(allPlaylistVideos, type, newDirection);
    setPlaylistVideos(sorted);
  };

  const handleVideoEnd = () => {
    if (!autoPlay || currentIndex == null) return;
    const nextIndex = currentIndex + 1;
    if (nextIndex < playlistVideos.length) {
      setCurrentIndex(nextIndex);
      setCurrentVideoId(playlistVideos[nextIndex].snippet.resourceId?.videoId);
    }
  };

  const skipVideo = (direction) => {
    if (currentIndex == null) return;
    const nextIndex = currentIndex + direction;
    if (nextIndex >= 0 && nextIndex < playlistVideos.length) {
      setCurrentIndex(nextIndex);
      setCurrentVideoId(playlistVideos[nextIndex].snippet.resourceId?.videoId);
    }
  };

  const acknowledgeIosAutoplay = () => {
    localStorage.setItem('iosAutoplayAcknowledged', 'true');
    setIosPrompted(true);
    setCurrentVideoId(playlistVideos[0]?.snippet.resourceId?.videoId);
  };

  const SettingsDrawer = () => (
    <>
      {showSettings && (
        <>
          <div className="drawer-overlay" onClick={() => setShowSettings(false)} />
          <div className={`settings-drawer open`}>
            <h2>Settings</h2>
            <div className="tab-buttons">
              <button onClick={() => setActiveTab('general')}>General</button>
              <button onClick={() => setActiveTab('theme')}>Theme</button>
              <button onClick={() => setActiveTab('account')}>Account</button>
            </div>
            <div className={`tab-content ${activeTab === 'general' ? 'active' : ''}`}>
              <button onClick={() => {
                setPersonalViews({});
                localStorage.removeItem('personalViews');
              }}>Reset Personal Views</button>
              <button onClick={() => setAutoPlay(!autoPlay)}>
                {autoPlay ? 'Disable Autoplay' : 'Enable Autoplay'}
              </button>
            </div>
            <div className={`tab-content ${activeTab === 'theme' ? 'active' : ''}`}>
              <button onClick={() => setTheme(theme === 'light' ? 'dark' : 'light')}>
                {theme === 'light' ? 'Enable Dark Mode' : 'Enable Light Mode'}
              </button>
            </div>
            <div className={`tab-content ${activeTab === 'account' ? 'active' : ''}`}>
              <button onClick={() => {
                setToken('');
                setIsLoggedIn(false);
                setPlaylists([]);
                setSelectedPlaylist(null);
                setPlaylistVideos([]);
                window.location.hash = '';
                setShowSettings(false);
              }}>Logout / Switch User</button>
            </div>
          </div>
        </>
      )}
    </>
  );

  return (
    <div className={theme}>
      {isLoggedIn ? (
        <>
          <button onClick={() => setShowSettings(true)}>⚙️ Settings</button>
          {SettingsDrawer()}
          {!selectedPlaylist ? (
            <ul>
              {playlists.map((pl) => (
                <li key={pl.id} onClick={() => fetchPlaylistVideos(pl)} style={{ cursor: 'pointer', marginBottom: '1rem' }}>
                  <img src={pl.snippet.thumbnails?.default?.url || ''} alt="thumbnail" /><br />
                  <strong>{pl.snippet.title}</strong>
                </li>
              ))}
            </ul>
          ) : (
            <div>
              <button onClick={() => {
                setSelectedPlaylist(null);
                setPlaylistVideos([]);
                setAllPlaylistVideos([]);
                setCurrentIndex(null);
                setCurrentVideoId(null);
              }}>← Back to Playlists</button>
              <h2>{selectedPlaylist.snippet.title}</h2>
              {!iosPrompted && isIOS && autoPlay && (
                <div style={{ textAlign: 'center', margin: '20px' }}>
                  <button onClick={acknowledgeIosAutoplay}>▶ Start Watching</button>
                </div>
              )}
              {(!isIOS || iosPrompted || !autoPlay) && (
                <YouTube
                  videoId={currentVideoId}
                  opts={{ playerVars: { autoplay: 1 } }}
                  onEnd={handleVideoEnd}
                  onReady={(event) => {
                    playerRef.current = event.target;
                    playerRef.current.setVolume(volume);
                  }}
                />
              )}
              <div>
                <button onClick={() => skipVideo(-1)}>Previous</button>
                <button onClick={() => skipVideo(1)}>Next</button>
                <input type="range" min="0" max="100" value={volume} onChange={(e) => {
                  const vol = parseInt(e.target.value);
                  setVolume(vol);
                  if (playerRef.current) playerRef.current.setVolume(vol);
                }} />
              </div>
              <div>
                <button onClick={() => sortPlaylistVideos('title')}>Sort by Title</button>
                <button onClick={() => sortPlaylistVideos('views')}>Sort by Personal Views</button>
                <button onClick={() => sortPlaylistVideos('dateAdded')}>Sort by Date Added</button>
                <button onClick={() => sortPlaylistVideos('datePublished')}>Sort by Date Published</button>
                <span>{sortDirection === 'asc' ? 'Ascending' : 'Descending'}</span>
              </div>
              <ul>
                {playlistVideos.map((video, index) => (
                  index >= currentIndex && (
                    <li key={video.snippet.resourceId?.videoId || index}>
                      <span style={{ marginRight: '8px' }}>{index + 1}.</span>
                      <img src={video.snippet.thumbnails?.default?.url || ''} alt="thumbnail" style={{ verticalAlign: 'middle' }} />
                      <strong>{video.snippet.title}</strong>
                      <div>Views: {personalViews[video.snippet.resourceId?.videoId] || 0}</div>
                    </li>
                  )
                ))}
              </ul>
            </div>
          )}
        </>
      ) : (
        <div style={{ textAlign: 'center', marginTop: '100px' }}>
          <button onClick={handleLogin}>Log in with Google</button>
          <p><a href="/privacy.html">Privacy Policy</a> | <a href="/terms.html">Terms and Conditions</a></p>
        </div>
      )}
    </div>
  );
}

export default App;
