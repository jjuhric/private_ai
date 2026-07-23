import React from 'react';
import { Eye, EyeOff } from 'lucide-react';

export default function Auth({
  authForm,
  setAuthForm,
  isLogin,
  setIsLogin,
  authError,
  setAuthError,
  handleAuthSubmit,
  showAuthPassword,
  setShowAuthPassword
}) {
  return (
    <div className="auth-container">
      <div className="auth-card">
        <div className="logo-container">
          <img 
            src="/logo.png" 
            alt="Logo" 
            className="app-logo" 
            onError={(e) => e.target.src = 'https://placehold.co/100x100?text=AG'} 
          />
          <img 
            src="/patti_text.png" 
            alt="PATTI" 
            className="patti-logo-image auth-patti-logo" 
          />
        </div>
        <h2>{isLogin ? 'Welcome Back' : 'Create Account'}</h2>
        
        {authError && <div className="error-banner">{authError}</div>}
        
        <form onSubmit={handleAuthSubmit}>
          <div className="form-group">
            <label>Username</label>
            <input 
              type="text" 
              className="form-control" 
              value={authForm.username}
              onChange={e => setAuthForm(prev => ({ ...prev, username: e.target.value }))}
              required
            />
          </div>
          <div className="form-group">
            <label>Password</label>
            <div style={{ position: 'relative' }}>
              <input 
                type={showAuthPassword ? 'text' : 'password'} 
                className="form-control" 
                style={{ paddingRight: '40px' }}
                value={authForm.password}
                onChange={e => setAuthForm(prev => ({ ...prev, password: e.target.value }))}
                required
              />
              <button
                type="button"
                onClick={() => setShowAuthPassword(!showAuthPassword)}
                style={{
                  position: 'absolute',
                  right: '10px',
                  top: '50%',
                  transform: 'translateY(-50%)',
                  background: 'none',
                  border: 'none',
                  color: 'var(--text-secondary)',
                  cursor: 'pointer',
                  display: 'flex',
                  alignItems: 'center',
                  padding: 0
                }}
              >
                {showAuthPassword ? <EyeOff size={18} /> : <Eye size={18} />}
              </button>
            </div>
          </div>
          <button type="submit" className="btn-primary" style={{ width: '100%' }}>
            {isLogin ? 'Login' : 'Register'}
          </button>
        </form>

        <p className="auth-switch">
          {isLogin ? "Don't have an account?" : "Already have an account?"}
          <span onClick={() => { setIsLogin(!isLogin); setAuthError(''); }}>
            {isLogin ? 'Register' : 'Login'}
          </span>
        </p>
      </div>
    </div>
  );
}
