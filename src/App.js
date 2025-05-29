import React, { useState, useEffect, useRef } from 'react';
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
  const [showTerms, setShowTerms] = useState(false);

  const loader = useRef(null);

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
    document.body.className = theme;
    localStorage.setItem('theme', theme);
  }, [theme]);

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
      'https://www.googleapis.com/youtube/v3/playlists?part=snippet&mine=true&maxResults=20',
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
    }
  };

  useEffect(() => {
    if (!loader.current) return;
    const observer = new IntersectionObserver(
      entries => {
        if (entries[0].isIntersecting && selectedPlaylist && nextPageToken) {
          fetchPlaylistVideos(selectedPlaylist, nextPageToken);
        }
      },
      { threshold: 1.0 }
    );
    observer.observe(loader.current);
    return () => observer.disconnect();
  }, [nextPageToken, selectedPlaylist]);

  useEffect(() => {
    localStorage.setItem('showSidebar', showSidebar);
  }, [showSidebar]);

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
    const newDirection = sortDirection === 'asc' ? 'desc' : 'asc';
    setSortDirection(newDirection);
    setSortType(type);

    const sorted = sortVideos(allPlaylistVideos, type, newDirection);
    setPlaylistVideos(sorted);
  };

  return (
    <div className={theme} style={{ display: 'flex', fontFamily: 'Arial', maxWidth: '1200px', margin: 'auto' }}>
      {isLoggedIn && showSettings && (
        <div className={`settings-drawer ${showSettings ? 'open' : ''}`}>
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
            }}>
              🔄 Reset Personal Views
            </button>
          </div>

          <div className={`tab-content ${activeTab === 'theme' ? 'active' : ''}`}>
            <button onClick={() => {
              const newTheme = theme === 'light' ? 'dark' : 'light';
              setTheme(newTheme);
              localStorage.setItem('theme', newTheme);
            }}>
              {theme === 'light' ? '🌙 Enable Dark Mode' : '☀️ Enable Light Mode'}
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
            }}>
              🚪 Logout / Switch User
            </button>
          </div>
        </div>
      )}
      <main style={{ flexGrow: 1 }}>
        <header>
          <h1>YouTube Playlist Sorter</h1>
          {isLoggedIn && <button onClick={() => setShowSettings(true)}>⚙️ Settings</button>}
        </header>
        {!isLoggedIn ? (
          <button onClick={handleLogin}>Log in with Google</button>
        ) : !selectedPlaylist ? (
          <ul>
            {playlists.map((pl) => (
              <li key={pl.id} onClick={() => fetchPlaylistVideos(pl)}>
                <img src={pl.snippet.thumbnails?.default?.url || pl.snippet.thumbnails?.medium?.url} alt="thumb" />
                <br />
                <strong>{pl.snippet.title}</strong>
              </li>
            ))}
          </ul>
        ) : (
          <div>
            <h2>{selectedPlaylist.snippet.title}</h2>
            <div>
              <button onClick={() => sortPlaylistVideos('title')}>Sort by Title</button>
              <button onClick={() => sortPlaylistVideos('views')}>Sort by Views</button>
              <button onClick={() => sortPlaylistVideos('dateAdded')}>Sort by Date Added</button>
              <button onClick={() => sortPlaylistVideos('datePublished')}>Sort by Date Published</button>
              <p>{sortDirection === 'asc' ? 'Ascending' : 'Descending'}</p>
            </div>
            <ul>
              {playlistVideos.map((video, idx) => (
                <li key={video.snippet.resourceId?.videoId || idx}>
                  <span>{idx + 1}. </span>
                  <img src={video.snippet.thumbnails.default.url} alt="thumb" />
                  <br />
                  <strong>{video.snippet.title}</strong>
                  <br />
                  Personal Views: {personalViews[video.snippet.resourceId?.videoId] || 0}
                </li>
              ))}
            </ul>
            <div ref={loader} style={{ height: '20px' }} />
          </div>
        )}
      </main>
    </div>
  );
}

export default App;
