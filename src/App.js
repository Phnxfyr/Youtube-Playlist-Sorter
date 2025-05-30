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
      `https://www.googleapis.com/youtube/v3/playlistItems?part=snippet,contentDetails&maxResults=50&playlistId=${playlist.id}&pageToken=${pageToken}`,
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
      const sorted = sortVideos(combined, sortType, sortDirection);
      setPlaylistVideos(sorted);
      setCurrentIndex(0);
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
      sorted.sort((a, b) => (new Date(a.contentDetails.videoPublishedAt || 0) - new Date(b.contentDetails.videoPublishedAt || 0)) * factor);
    }

    return sorted;
  };

  const handleVideoEnd = () => {
    if (!currentVideoId) return;
    setPersonalViews(prev => {
      const newViews = { ...prev };
      newViews[currentVideoId] = (newViews[currentVideoId] || 0) + 1;
      return newViews;
    });

    if (!autoPlay || currentIndex == null) return;
    const nextIndex = currentIndex + 1;
    if (nextIndex < playlistVideos.length) {
      setCurrentIndex(nextIndex);
      setCurrentVideoId(playlistVideos[nextIndex].snippet.resourceId?.videoId);
    }
  };

  const handleVideoClick = (index) => {
    if (index >= 0 && index < playlistVideos.length) {
      setCurrentIndex(index);
      setCurrentVideoId(playlistVideos[index].snippet.resourceId?.videoId);
    }
  };

  const toggleFavorite = (videoId) => {
    setFavorites((prev) => {
      const updated = prev.includes(videoId) ? prev.filter(id => id !== videoId) : [...prev, videoId];
      return updated;
    });
  };

  const filteredVideos = playlistVideos.filter(video => {
    const videoId = video.snippet.resourceId?.videoId;
    const matchesSearch = video.snippet.title.toLowerCase().includes(searchQuery.toLowerCase());
    const matchesFavorite = !showFavorites || favorites.includes(videoId);
    const notPlayed = !hidePlayed || !personalViews[videoId];
    return matchesSearch && matchesFavorite && notPlayed;
  });

  return (
    <div className={`app-container ${theme}`} style={{ display: 'flex' }}>
      <div style={{ flex: 1, textAlign: 'center', display: 'flex', flexDirection: 'column', alignItems: 'center' }}>
        {!isLoggedIn ? (
          <div style={{ marginTop: '20vh' }}>
            <h1 style={{ fontSize: '2em', marginBottom: '1em' }}>YouTube Playlist Sorter</h1>
            <button onClick={handleLogin} style={{ fontSize: '1.2em', padding: '10px 20px' }}>Log in with Google</button>
            <p><a href="/privacy.html">Privacy Policy</a> | <a href="/terms.html">Terms and Conditions</a></p>
          </div>
        ) : selectedPlaylist ? (
          <div>
            <button onClick={() => {
              setSelectedPlaylist(null);
              setPlaylistVideos([]);
              setAllPlaylistVideos([]);
              setCurrentIndex(null);
              setCurrentVideoId(null);
            }}>← Back to Playlists</button>
            <h2>{selectedPlaylist.snippet.title}</h2>

            <div>
              <label>Sort by: </label>
              <select value={sortType} onChange={(e) => {
                const newType = e.target.value;
                setSortType(newType);
                setPlaylistVideos(sortVideos(playlistVideos, newType, sortDirection));
              }}>
                <option value="">None</option>
                <option value="title">Title</option>
                <option value="views">Views</option>
                <option value="dateAdded">Date Added</option>
                <option value="datePublished">Date Published</option>
              </select>
              <button onClick={() => {
                const newDirection = sortDirection === 'asc' ? 'desc' : 'asc';
                setSortDirection(newDirection);
                setPlaylistVideos(sortVideos(playlistVideos, sortType, newDirection));
              }}>
                {sortDirection === 'asc' ? 'Ascending' : 'Descending'}
              </button>
              <input
                type="text"
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                placeholder="Search videos..."
              />
              <button onClick={() => setShowFavorites(!showFavorites)}>
                {showFavorites ? 'Show All' : 'Show Favorites'}
              </button>
            </div>

            {!iosPrompted && isIOS && autoPlay && playlistVideos.length > 0 && (
              <div style={{ textAlign: 'center', margin: '20px' }}>
                <button onClick={() => {
                  setIosPrompted(true);
                  setCurrentVideoId(playlistVideos[0]?.snippet.resourceId?.videoId);
                }}>▶ Start Watching</button>
              </div>
            )}

            {(!isIOS || iosPrompted || !autoPlay) && currentVideoId && (
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
              <button onClick={() => handleVideoClick(currentIndex - 1)}>Previous</button>
              <button onClick={() => handleVideoClick(currentIndex + 1)}>Next</button>
              <input
                type="range"
                min="0"
                max="100"
                value={volume}
                onChange={(e) => {
                  const vol = parseInt(e.target.value);
                  setVolume(vol);
                  if (playerRef.current) playerRef.current.setVolume(vol);
                }}
              />
            </div>

            <ul>
              {filteredVideos.map((video, index) => {
                const videoId = video.snippet.resourceId?.videoId;
                return (
                  <li key={videoId || index} onClick={() => handleVideoClick(index)}>
                    <span style={{ marginRight: '8px' }}>{index + 1}.</span>
                    <img src={video.snippet.thumbnails?.default?.url || ''} alt="thumbnail" style={{ verticalAlign: 'middle' }} />
                    <strong>{video.snippet.title}</strong>
                    <div>Views: {personalViews[videoId] || 0}</div>
                    <button onClick={(e) => {
                      e.stopPropagation();
                      toggleFavorite(videoId);
                    }}>
                      {favorites.includes(videoId) ? '★' : '☆'}
                    </button>
                  </li>
                );
              })}
            </ul>
          </div>
        ) : (
          <>
            <button onClick={handleLogout} style={{ marginTop: '1rem' }}>Log Out</button>
            <ul style={{ marginTop: '10vh', fontSize: '1.2em' }}>
              {playlists.map((pl) => (
                <li key={pl.id} onClick={() => fetchPlaylistVideos(pl)} style={{ cursor: 'pointer', marginBottom: '1em' }}>
                  <img src={pl.snippet.thumbnails?.default?.url || ''} alt="thumbnail" style={{ width: '100px', height: '100px' }} /><br />
                  <strong>{pl.snippet.title}</strong>
                </li>
              ))}
            </ul>
          </>
        )}
      </div>
      {isLoggedIn && (
        <div style={{ width: '280px', padding: '20px', marginTop: '10vh' }}>
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
                  <button onClick={() => setHidePlayed(!hidePlayed)}>
                    {hidePlayed ? 'Show Played Songs' : 'Hide Played Songs'}
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
