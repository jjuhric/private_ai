CREATE TABLE IF NOT EXISTS users (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  username TEXT UNIQUE NOT NULL,
  password_hash TEXT NOT NULL,
  email TEXT,
  name TEXT,
  zipcode TEXT,
  country TEXT DEFAULT 'US',
  temp_unit TEXT DEFAULT 'imperial',
  weather_api_key TEXT,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS chats (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER NOT NULL,
  title TEXT NOT NULL,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS messages (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  chat_id INTEGER NOT NULL,
  role TEXT NOT NULL, -- 'user', 'assistant' (or 'model' / 'thought')
  content TEXT NOT NULL,
  thoughts TEXT, -- reasoning/steps
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (chat_id) REFERENCES chats(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS calendar_events (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER NOT NULL,
  title TEXT NOT NULL,
  description TEXT,
  start_time TEXT NOT NULL, -- ISO-8601 string e.g. YYYY-MM-DD HH:MM
  end_time TEXT NOT NULL, -- ISO-8601 string
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS user_settings (
  user_id INTEGER PRIMARY KEY,
  provider TEXT DEFAULT 'local', -- 'local' or 'gemini' (or 'openai', 'anthropic')
  model_name TEXT DEFAULT 'google/gemma-4-e4b',
  github_token TEXT,
  gemini_key TEXT, -- legacy, replaced by online_key
  local_key TEXT,
  local_url TEXT DEFAULT 'http://192.168.1.42:1234/v1',
  local_api_style TEXT DEFAULT 'openai', -- 'openai', 'lm-studio', 'anthropic'
  online_url TEXT,
  online_key TEXT,
  online_provider TEXT DEFAULT 'gemini', -- 'gemini', 'openai', 'anthropic', 'custom'
  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS memories (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER NOT NULL,
  content TEXT NOT NULL,
  level TEXT NOT NULL, -- 'short-term' or 'long-term'
  expires_at DATETIME, -- NULL for long-term, timestamp for short-term
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  embedding TEXT,
  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
);
