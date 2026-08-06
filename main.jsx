import React from 'react';
import { createRoot } from 'react-dom/client';
import './index.css';
import SongBruhs from './SongBruhs.jsx';

createRoot(document.getElementById('root')).render(
  <React.StrictMode>
    <SongBruhs />
  </React.StrictMode>,
);
