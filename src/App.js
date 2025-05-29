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
  const [autoPlay, setAutoPlay] = useState(false);
  const [currentIndex, setCurrentIndex] = useState(null);
  const [currentVideoId, setCurrentVideoId] = useState(null);
  const [volume, setVolume] = useState(50);

  const loader = useRef(null);
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
      setCurrentIndex(0);
      setCurrentVideoId(combined[0]?.snippet.resourceId?.videoId || null);
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

  const SettingsDrawer = () => (
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
        }}>Reset Personal Views</button>
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
  );

  return (
    <div className={theme}>
      {!isLoggedIn ? (
        <div>
          <button onClick={handleLogin}>Log in with Google</button>
          <br /><br />
          <a href="#" onClick={() => alert('Privacy Policy goes here.')}>Privacy Policy</a> |
          <a href="#" onClick={() => alert('Terms and Conditions go here.')}> Terms & Conditions</a>
        </div>
      ) : (
        <div>
          <button onClick={() => setShowSettings(!showSettings)}>⚙️ Settings</button>
          {SettingsDrawer()}
          {/* Rest of app UI as previously updated */}
        </div>
      )}
    </div>
  );
}

export default App;
