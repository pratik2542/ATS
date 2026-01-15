import React, { useState, useEffect } from 'react';
import {
  browserLocalPersistence,
  createUserWithEmailAndPassword,
  EmailAuthProvider,
  fetchSignInMethodsForEmail,
  linkWithCredential,
  onAuthStateChanged,
  setPersistence,
  signInAnonymously,
  signInWithEmailAndPassword,
  signOut,
  updateProfile,
  User,
} from 'firebase/auth';
import { doc, serverTimestamp, setDoc } from 'firebase/firestore';
import { getFirebaseAuth, getFirestore, isFirebaseEnabled } from '../../firebase/firebase';
import { tryCloudPullAllToLocal } from '../../firebase/sync';

interface SettingsProps {
  settings: {
    openaiApiKey: string;
    geminiApiKey: string;
    aiProvider: 'openai' | 'gemini';
  };
  onSettingsSave: (settings: {
    openaiApiKey: string;
    geminiApiKey: string;
    aiProvider: 'openai' | 'gemini';
  }) => void;
  onBack: () => void;
}

const Settings: React.FC<SettingsProps> = ({ settings, onSettingsSave, onBack }) => {
  const [localSettings, setLocalSettings] = useState(settings);
  const [showOpenAIKey, setShowOpenAIKey] = useState(false);
  const [showGeminiKey, setShowGeminiKey] = useState(false);
  const [saved, setSaved] = useState(false);

  const [cloudUser, setCloudUser] = useState<User | null>(null);
  const [cloudMode, setCloudMode] = useState<'signin' | 'signup'>('signin');
  const [cloudDisplayName, setCloudDisplayName] = useState('');
  const [cloudEmail, setCloudEmail] = useState('');
  const [cloudPassword, setCloudPassword] = useState('');
  const [cloudConfirmPassword, setCloudConfirmPassword] = useState('');
  const [cloudAuthError, setCloudAuthError] = useState('');
  const [cloudBusy, setCloudBusy] = useState(false);

  const formatAuthError = (e: any): string => {
    const code = String(e?.code || '');
    const message = String(e?.message || '');

    if (code.includes('auth/operation-not-allowed')) {
      return 'This sign-in method is disabled in Firebase. Enable Authentication → Sign-in method → Email/Password (and Anonymous if using guest), then try again.';
    }
    if (code.includes('auth/admin-restricted-operation')) {
      return 'Firebase Auth is blocking this operation. Check Firebase Authentication settings and enable the required sign-in method.';
    }
    if (code.includes('auth/email-already-in-use') || code.includes('auth/credential-already-in-use')) {
      return 'That email is already linked to another account. Use Sign out → Sign in with that email, or choose a different email.';
    }
    if (code.includes('auth/invalid-email')) {
      return 'Invalid email address.';
    }
    if (code.includes('auth/weak-password')) {
      return 'Password is too weak (Firebase requires at least 6 characters).';
    }
    if (code.includes('auth/wrong-password') || code.includes('auth/invalid-credential')) {
      return 'Incorrect email or password.';
    }
    if (code.includes('auth/requires-recent-login')) {
      return 'Please sign out and sign back in, then try again.';
    }

    return message || 'Authentication failed';
  };

  useEffect(() => {
    setLocalSettings(settings);
  }, [settings]);

  useEffect(() => {
    if (!isFirebaseEnabled()) return;

    const firebaseAuth = getFirebaseAuth();
    if (!firebaseAuth) return;

    void setPersistence(firebaseAuth, browserLocalPersistence).catch(() => {
      // ok
    });

    const unsub = onAuthStateChanged(firebaseAuth, (u) => {
      setCloudUser(u);
      setCloudAuthError('');
    });
    return () => unsub();
  }, []);

  const handleSave = () => {
    onSettingsSave(localSettings);
    setSaved(true);
    setTimeout(() => setSaved(false), 2000);
  };

  const doCloudSignIn = async () => {
    setCloudAuthError('');
    setCloudBusy(true);
    try {
      const firebaseAuth = getFirebaseAuth();
      if (!firebaseAuth) throw new Error('Firebase is not configured. Add Firebase env vars and rebuild.');
      await signInWithEmailAndPassword(firebaseAuth, cloudEmail.trim(), cloudPassword);
      void tryCloudPullAllToLocal();
    } catch (e: any) {
      console.warn('Cloud sign-in failed:', e);
      setCloudAuthError(formatAuthError(e));
    } finally {
      setCloudBusy(false);
    }
  };

  const doCloudSignUp = async () => {
    setCloudAuthError('');
    setCloudBusy(true);
    try {
      const firebaseAuth = getFirebaseAuth();
      const firestore = getFirestore();
      if (!firebaseAuth || !firestore) throw new Error('Firebase is not configured. Add Firebase env vars and rebuild.');

      const email = cloudEmail.trim();
      if (!email) throw new Error('Email is required');
      if (!cloudPassword) throw new Error('Password is required');
      if (cloudPassword !== cloudConfirmPassword) throw new Error('Passwords do not match');

      const cred = await createUserWithEmailAndPassword(firebaseAuth, email, cloudPassword);

      const name = cloudDisplayName.trim();
      if (name) {
        await updateProfile(cred.user, { displayName: name });
      }

      // Create a profile document so the user is clearly identifiable in Firestore.
      await setDoc(
        doc(firestore, 'users', cred.user.uid),
        {
          uid: cred.user.uid,
          email,
          displayName: name || null,
          createdAt: serverTimestamp(),
        },
        { merge: true }
      );
    } catch (e: any) {
      console.warn('Cloud sign-up failed:', e);
      setCloudAuthError(formatAuthError(e));
    } finally {
      setCloudBusy(false);
    }
  };

  const doCloudContinueAsGuest = async () => {
    setCloudAuthError('');
    setCloudBusy(true);
    try {
      const firebaseAuth = getFirebaseAuth();
      const firestore = getFirestore();
      if (!firebaseAuth || !firestore) throw new Error('Firebase is not configured. Add Firebase env vars and rebuild.');

      const cred = await signInAnonymously(firebaseAuth);

      // Create a lightweight profile doc so the guest user still has a UID record.
      await setDoc(
        doc(firestore, 'users', cred.user.uid),
        {
          uid: cred.user.uid,
          email: null,
          displayName: null,
          isAnonymous: true,
          createdAt: serverTimestamp(),
        },
        { merge: true }
      );
    } catch (e: any) {
      console.warn('Cloud guest sign-in failed:', e);
      setCloudAuthError(formatAuthError(e));
    } finally {
      setCloudBusy(false);
    }
  };

  const doCloudUpgradeGuestToAccount = async () => {
    setCloudAuthError('');
    setCloudBusy(true);
    try {
      const firebaseAuth = getFirebaseAuth();
      const firestore = getFirestore();
      if (!firebaseAuth || !firestore) throw new Error('Firebase is not configured. Add Firebase env vars and rebuild.');
      const user = firebaseAuth.currentUser;
      if (!user) throw new Error('Not signed in');
      if (!user.isAnonymous) throw new Error('This session is already a full account');

      const email = cloudEmail.trim();
      if (!email) throw new Error('Email is required');
      if (!cloudPassword) throw new Error('Password is required');
      if (cloudPassword !== cloudConfirmPassword) throw new Error('Passwords do not match');

      // Helpful early check: if this email already has a sign-in method, linking will fail.
      try {
        const methods = await fetchSignInMethodsForEmail(firebaseAuth, email);
        if (methods?.length) {
          throw new Error('auth/email-already-in-use');
        }
      } catch (checkErr: any) {
        // If the check throws a Firebase auth error code, surface it.
        const code = String(checkErr?.code || '');
        if (code) throw checkErr;
        // If we threw our own sentinel error above, normalize it.
        if (String(checkErr?.message || '') === 'auth/email-already-in-use') {
          throw { code: 'auth/email-already-in-use' };
        }
      }

      const credential = EmailAuthProvider.credential(email, cloudPassword);
      const linked = await linkWithCredential(user, credential);

      const name = cloudDisplayName.trim();
      if (name) {
        await updateProfile(linked.user, { displayName: name });
      }

      await setDoc(
        doc(firestore, 'users', linked.user.uid),
        {
          uid: linked.user.uid,
          email,
          displayName: name || null,
          isAnonymous: false,
          upgradedAt: serverTimestamp(),
        },
        { merge: true }
      );
    } catch (e: any) {
      console.warn('Cloud upgrade failed:', e);
      setCloudAuthError(formatAuthError(e));
    } finally {
      setCloudBusy(false);
    }
  };

  const doCloudSignOut = async () => {
    setCloudAuthError('');
    setCloudBusy(true);
    try {
      const firebaseAuth = getFirebaseAuth();
      if (!firebaseAuth) throw new Error('Firebase is not configured. Add Firebase env vars and rebuild.');
      await signOut(firebaseAuth);
    } catch (e: any) {
      setCloudAuthError(e?.message || 'Sign-out failed');
    } finally {
      setCloudBusy(false);
    }
  };

  return (
    <div>
      <div className="header">
        <button className="back-button" onClick={onBack}>
          ← Back
        </button>
        <div className="topbar">
          <div className="topbar-left">
            <h1 className="topbar-title">Settings</h1>
            <p className="topbar-subtitle">Keys, provider, privacy</p>
          </div>
          <div className="topbar-actions">
            {saved ? <span className="chip success">Saved</span> : <span className="chip">Local only</span>}
          </div>
        </div>
      </div>

      <div className="content">
        <div className="status-card" style={{ marginBottom: '14px' }}>
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: '12px', marginBottom: '10px' }}>
            <div style={{ fontSize: '14px', fontWeight: 800 }}>☁️ Cloud Sync Account</div>
            <span className={`chip ${isFirebaseEnabled() ? 'info' : ''}`}>{isFirebaseEnabled() ? 'Enabled' : 'Disabled'}</span>
          </div>

          {!isFirebaseEnabled() ? (
            <p style={{ fontSize: '12px', color: 'var(--muted)', margin: 0 }}>
              Firebase is not configured. Add Firebase env vars and rebuild (see README).
            </p>
          ) : cloudUser ? (
            <div style={{ display: 'grid', gap: '10px' }}>
              <div style={{ fontSize: '12px', color: 'var(--muted)' }}>
                Signed in as <strong style={{ color: 'var(--text)' }}>{cloudUser.displayName || cloudUser.email || 'user'}</strong>
                <div style={{ marginTop: '6px' }}>UID: <span style={{ fontFamily: 'ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, "Liberation Mono", "Courier New", monospace' }}>{cloudUser.uid}</span></div>
                {cloudUser.isAnonymous && (
                  <div style={{ marginTop: '6px', color: 'var(--warning)' }}>
                    Guest session (anonymous). Create an account to avoid losing access if you sign out.
                  </div>
                )}
              </div>

              {cloudUser.isAnonymous && (
                <div className="status-card" style={{ margin: 0, padding: '12px' }}>
                  <div style={{ fontWeight: 800, marginBottom: '8px' }}>Upgrade guest to account</div>
                  <div style={{ display: 'grid', gap: '10px' }}>
                    <div className="form-group">
                      <label className="form-label">Full name (optional)</label>
                      <input className="form-input" value={cloudDisplayName} onChange={(e) => setCloudDisplayName(e.target.value)} placeholder="Your name" />
                    </div>
                    <div className="form-group">
                      <label className="form-label">Email</label>
                      <input className="form-input" value={cloudEmail} onChange={(e) => setCloudEmail(e.target.value)} placeholder="you@example.com" />
                    </div>
                    <div className="form-group">
                      <label className="form-label">Password</label>
                      <input className="form-input" type="password" value={cloudPassword} onChange={(e) => setCloudPassword(e.target.value)} placeholder="••••••••" />
                    </div>
                    <div className="form-group">
                      <label className="form-label">Confirm password</label>
                      <input className="form-input" type="password" value={cloudConfirmPassword} onChange={(e) => setCloudConfirmPassword(e.target.value)} placeholder="••••••••" />
                    </div>

                    <button className="btn btn-primary btn-block" disabled={cloudBusy} onClick={() => void doCloudUpgradeGuestToAccount()}>
                      Upgrade to account
                    </button>
                    <p style={{ fontSize: '12px', color: 'var(--muted)', margin: 0 }}>
                      This links your current guest UID to email/password so your cloud data stays accessible.
                    </p>
                  </div>
                </div>
              )}

              <button className="btn btn-secondary btn-block" disabled={cloudBusy} onClick={() => void doCloudSignOut()}>
                Sign out
              </button>
              <p style={{ fontSize: '12px', color: 'var(--muted)', margin: 0 }}>
                Use the same account on the web dashboard to view/edit resumes.
              </p>
            </div>
          ) : (
            <div style={{ display: 'grid', gap: '10px' }}>
              <div style={{ display: 'flex', gap: '10px' }}>
                <button
                  className={`btn ${cloudMode === 'signin' ? 'btn-primary' : 'btn-secondary'}`}
                  style={{ flex: 1 }}
                  disabled={cloudBusy}
                  onClick={() => {
                    setCloudMode('signin');
                    setCloudAuthError('');
                  }}
                >
                  Sign in
                </button>
                <button
                  className={`btn ${cloudMode === 'signup' ? 'btn-primary' : 'btn-secondary'}`}
                  style={{ flex: 1 }}
                  disabled={cloudBusy}
                  onClick={() => {
                    setCloudMode('signup');
                    setCloudAuthError('');
                  }}
                >
                  Create account
                </button>
              </div>

              {cloudMode === 'signup' && (
                <div className="form-group">
                  <label className="form-label">Full name (optional)</label>
                  <input className="form-input" value={cloudDisplayName} onChange={(e) => setCloudDisplayName(e.target.value)} placeholder="Your name" />
                </div>
              )}

              <div className="form-group">
                <label className="form-label">Email</label>
                <input className="form-input" value={cloudEmail} onChange={(e) => setCloudEmail(e.target.value)} placeholder="you@example.com" />
              </div>
              <div className="form-group">
                <label className="form-label">Password</label>
                <input className="form-input" type="password" value={cloudPassword} onChange={(e) => setCloudPassword(e.target.value)} placeholder="••••••••" />
              </div>

              {cloudMode === 'signup' && (
                <div className="form-group">
                  <label className="form-label">Confirm password</label>
                  <input className="form-input" type="password" value={cloudConfirmPassword} onChange={(e) => setCloudConfirmPassword(e.target.value)} placeholder="••••••••" />
                </div>
              )}

              {cloudAuthError && (
                <div className="alert warning">
                  <span className="alert-icon">⚠️</span>
                  <div>
                    <strong>Cloud auth error</strong>
                    <p>{cloudAuthError}</p>
                  </div>
                </div>
              )}

              <button
                className="btn btn-primary btn-block"
                disabled={cloudBusy}
                onClick={() => void (cloudMode === 'signin' ? doCloudSignIn() : doCloudSignUp())}
              >
                {cloudMode === 'signin' ? 'Sign in' : 'Create account'}
              </button>

              <button
                className="btn btn-secondary btn-block"
                disabled={cloudBusy}
                onClick={() => void doCloudContinueAsGuest()}
                title="This creates an anonymous Firebase user (legacy behavior)."
              >
                Continue as guest
              </button>

              <p style={{ fontSize: '12px', color: 'var(--muted)', margin: 0 }}>
                Each account has its own UID, so your resumes stay private and separated.
              </p>
            </div>
          )}
        </div>

        <div className="status-card">
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: '12px', marginBottom: '10px' }}>
            <div style={{ fontSize: '14px', fontWeight: 800 }}>🤖 AI Provider</div>
            <span className="chip info">{localSettings.aiProvider === 'openai' ? 'OpenAI' : 'Gemini'}</span>
          </div>
          
          <div className="form-group">
            <label className="form-label">Select AI Model</label>
            <select 
              className="form-input"
              value={localSettings.aiProvider}
              onChange={(e) => setLocalSettings({...localSettings, aiProvider: e.target.value as 'openai' | 'gemini'})}
            >
              <option value="openai">OpenAI (GPT-4)</option>
              <option value="gemini">Google Gemini (Pro/Flash)</option>
            </select>
          </div>
        </div>

        {localSettings.aiProvider === 'openai' && (
          <div className="status-card">
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: '12px', marginBottom: '8px' }}>
              <div style={{ fontSize: '14px', fontWeight: 800 }}>🔑 OpenAI API Key</div>
              <button className="icon-button" onClick={() => setShowOpenAIKey(!showOpenAIKey)} title="Show/Hide">
                {showOpenAIKey ? '🙈' : '👁️'}
              </button>
            </div>
            <p style={{ fontSize: '12px', color: 'var(--muted)', marginBottom: '14px' }}>
              Required for GPT-4 based analysis
            </p>

            <div className="form-group">
              <label className="form-label">API Key</label>
              <div style={{ position: 'relative' }}>
                <input
                  type={showOpenAIKey ? 'text' : 'password'}
                  className="form-input"
                  value={localSettings.openaiApiKey}
                  onChange={(e) => setLocalSettings({...localSettings, openaiApiKey: e.target.value})}
                  placeholder="sk-..."
                />
              </div>
            </div>
            
            <div style={{ marginTop: '10px' }}>
              <p style={{ fontSize: '12px', color: 'var(--muted)' }}>
                Get your key at <a href="https://platform.openai.com/api-keys" target="_blank">platform.openai.com</a>
              </p>
            </div>
          </div>
        )}

        {localSettings.aiProvider === 'gemini' && (
          <div className="status-card">
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: '12px', marginBottom: '8px' }}>
              <div style={{ fontSize: '14px', fontWeight: 800 }}>✨ Gemini API Key</div>
              <button className="icon-button" onClick={() => setShowGeminiKey(!showGeminiKey)} title="Show/Hide">
                {showGeminiKey ? '🙈' : '👁️'}
              </button>
            </div>
            <p style={{ fontSize: '12px', color: 'var(--muted)', marginBottom: '14px' }}>
              Required for Google Gemini based analysis
            </p>

            <div className="form-group">
              <label className="form-label">API Key</label>
              <div style={{ position: 'relative' }}>
                <input
                  type={showGeminiKey ? 'text' : 'password'}
                  className="form-input"
                  value={localSettings.geminiApiKey}
                  onChange={(e) => setLocalSettings({...localSettings, geminiApiKey: e.target.value})}
                  placeholder="AI..."
                />
              </div>
            </div>

            <div style={{ marginTop: '10px' }}>
              <p style={{ fontSize: '12px', color: 'var(--muted)' }}>
                Get your key at <a href="https://aistudio.google.com/app/apikey" target="_blank">aistudio.google.com</a>
              </p>
            </div>
          </div>
        )}

        <button
          className="btn btn-primary btn-block"
          onClick={handleSave}
          style={{ marginTop: '20px' }}
        >
          {saved ? '✓ Saved!' : 'Save Settings'}
        </button>

        <div className="status-card" style={{ marginTop: '14px' }}>
          <div style={{ fontSize: '14px', fontWeight: 800, marginBottom: '8px' }}>🛡️ Privacy & Security</div>
          <ul style={{ fontSize: '13px', color: 'var(--muted)', lineHeight: '1.8', paddingLeft: '20px' }}>
            <li>Your API keys are stored locally on your device</li>
            <li>No data is sent to third-party servers except your chosen AI provider</li>
          </ul>
        </div>


        <div style={{ marginTop: '16px', textAlign: 'center' }}>
          <p style={{ fontSize: '12px', color: 'var(--muted2)' }}>
            ATS Resume Tracker v1.0.0
          </p>
        </div>
      </div>
    </div>
  );
};

export default Settings;
