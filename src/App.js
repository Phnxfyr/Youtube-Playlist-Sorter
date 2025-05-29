import React, { useState, useEffect, useRef } from 'react';
import YouTube from 'react-youtube';
import './App.css';
import './theme.css';

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
  const [autoPlay, setAutoPlay] = useState(false);
  const [currentIndex, setCurrentIndex] = useState(null);
  const [currentVideoId, setCurrentVideoId] = useState(null);
  const [volume, setVolume] = useState(50);
  const [isPremium, setIsPremium] = useState(true);
  const [backgroundPlayback, setBackgroundPlayback] = useState(() => localStorage.getItem('backgroundPlayback') === 'true');
  const [lowPowerMode, setLowPowerMode] = useState(() => localStorage.getItem('lowPowerMode') === 'true');

  const playerRef = useRef(null);

  const CLIENT_ID = '53619685564-bbu592j78l7ir1unr3v5orbvc7ri1eu5.apps.googleusercontent.com';
  const REDIRECT_URI = 'https://youtube-playlist-sorter.vercel.app';
  const SCOPE = 'https://www.googleapis.com/auth/youtube.readonly';
  const RESPONSE_TYPE = 'token';

  useEffect(() => {
    const savedViews = localStorage.getItem('personalViews');
    if (savedViews) setPersonalViews(JSON.parse(savedViews));

    const savedTheme = localStorage.getItem('theme');
    if (savedTheme) setTheme(savedTheme);
  }, []);

  useEffect(() => {
    document.body.className = `${theme}${lowPowerMode ? ' low-power' : ''}`;
    localStorage.setItem('theme', theme);
    localStorage.setItem('lowPowerMode', lowPowerMode);
  }, [theme, lowPowerMode]);

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
      setCurrentIndex(0);
      const sorted = sortVideos(combined, sortType, sortDirection);
      setPlaylistVideos(sorted);
      setCurrentVideoId(sorted[0]?.snippet.resourceId?.videoId);
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

  const handleVideoEnd = () => {
    if (currentIndex == null) return;
    const currentVideo = playlistVideos[currentIndex];
    const videoId = currentVideo.snippet.resourceId?.videoId;

    setPersonalViews((prev) => {
      const updated = { ...prev, [videoId]: (prev[videoId] || 0) + 1 };
      localStorage.setItem('personalViews', JSON.stringify(updated));
      return updated;
    });

    if (!autoPlay) return;

    const nextIndex = currentIndex + 1;
    if (nextIndex < playlistVideos.length) {
      setCurrentIndex(nextIndex);
      setCurrentVideoId(playlistVideos[nextIndex].snippet.resourceId?.videoId);
    }
  };

  const handleVideoClick = (index) => {
    setCurrentIndex(index);
    setCurrentVideoId(playlistVideos[index].snippet.resourceId?.videoId);
  };

  return (
    <div className={theme} style={{ display: 'flex' }}>
      <div style={{ flex: 1, textAlign: 'center' }}>
        {!isLoggedIn ? (
          <div style={{ marginTop: '20vh' }}>
            <button onClick={handleLogin}>Log in with Google</button>
            <p><a href="/privacy.html">Privacy Policy</a> | <a href="/terms.html">Terms and Conditions</a></p>
          </div>
        ) : (
          <>
            {!selectedPlaylist ? (
              <ul style={{ marginTop: '10vh' }}>
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
                <YouTube
                  videoId={currentVideoId}
                  opts={{ playerVars: { autoplay: 1 } }}
                  onEnd={handleVideoEnd}
                  onReady={(event) => {
                    playerRef.current = event.target;
                    playerRef.current.setVolume(volume);
                  }}
                />
                <div>
                  <button onClick={() => handleVideoClick(currentIndex - 1)}>Previous</button>
                  <button onClick={() => handleVideoClick(currentIndex + 1)}>Next</button>
                  <input type="range" min="0" max="100" value={volume} onChange={(e) => {
                    const vol = parseInt(e.target.value);
                    setVolume(vol);
                    if (playerRef.current) playerRef.current.setVolume(vol);
                  }} />
                </div>
                <ul>
                  {playlistVideos.map((video, index) => (
                    <li
                      key={video.snippet.resourceId?.videoId || index}
                      onClick={() => handleVideoClick(index)}
                      style={{ cursor: 'pointer' }}
                    >
                      <span style={{ marginRight: '8px' }}>{index + 1}.</span>
                      <img src={video.snippet.thumbnails?.default?.url || ''} alt="thumbnail" style={{ verticalAlign: 'middle' }} />
                      <strong>{video.snippet.title}</strong>
                      <div>Views: {personalViews[video.snippet.resourceId?.videoId] || 0}</div>
                    </li>
                  ))}
                </ul>
              </div>
            )}
          </>
        )}
      </div>
      {isLoggedIn && (
        <div style={{ width: '300px', padding: '20px', position: 'relative', top: '5vh' }}>
          <button onClick={() => setShowSettings(!showSettings)}>⚙️ Settings</button>
          {showSettings && (
            <div className="settings">
              <div className="tab-buttons">
                <button onClick={() => setActiveTab('general')}>General</button>
                <button onClick={() => setActiveTab('theme')}>Theme</button>
              </div>
              {activeTab === 'general' && (
                <>
                  <button onClick={() => setAutoPlay(!autoPlay)}>
                    {autoPlay ? 'Disable Autoplay' : 'Enable Autoplay'}
                  </button>
                  <button onClick={() => {
                    setPersonalViews({});
                    localStorage.removeItem('personalViews');
                  }}>Reset Personal Views</button>
                </>
              )}
              {activeTab === 'theme' && (
                <>
                  <button onClick={() => setTheme(theme === 'light' ? 'dark' : 'light')}>
                    {theme === 'light' ? 'Enable Dark Mode' : 'Enable Light Mode'}
                  </button>
                  <button onClick={() => setLowPowerMode(!lowPowerMode)}>
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
