import React, { useEffect, useMemo, useRef, useState } from 'react';
import ReactDOM from 'react-dom/client';
import {
  browserLocalPersistence,
  createUserWithEmailAndPassword,
  onAuthStateChanged,
  setPersistence,
  signInWithEmailAndPassword,
  signOut,
  updateProfile,
  User,
} from 'firebase/auth';
import {
  collection,
  doc,
  onSnapshot,
  orderBy,
  query,
  serverTimestamp,
  setDoc,
} from 'firebase/firestore';

import type { Resume } from '../types';
import { getFirebaseAuth, getFirestore, isFirebaseEnabled } from '../firebase/firebase';

import '../popup/popup.css';
import './web.css';

type CloudResumeDoc = {
  id: string;
  name: string;
  uploadDate: number;
  isDefault: boolean;
  parsedText: string;
  pdfChunkCount?: number;
  updatedAt?: any;
};

const App: React.FC = () => {
  const enabled = isFirebaseEnabled();

  const [user, setUser] = useState<User | null>(null);
  const [authMode, setAuthMode] = useState<'signin' | 'signup'>('signin');
  const [displayName, setDisplayName] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [authError, setAuthError] = useState<string>('');

  const [resumes, setResumes] = useState<CloudResumeDoc[]>([]);
  const [selectedId, setSelectedId] = useState<string>('');

  const selected = useMemo(() => resumes.find(r => r.id === selectedId) || null, [resumes, selectedId]);
  const [draftName, setDraftName] = useState('');
  const [draftText, setDraftText] = useState('');
  const [saving, setSaving] = useState(false);
  const [saveNote, setSaveNote] = useState<string>('');

  const saveTimer = useRef<number | null>(null);

  useEffect(() => {
    if (!enabled) return;

    const firebaseAuth = getFirebaseAuth();
    if (!firebaseAuth) return;

    void setPersistence(firebaseAuth, browserLocalPersistence).catch(() => {
      // ok
    });

    const unsub = onAuthStateChanged(firebaseAuth, (u) => {
      setUser(u);
      setAuthError('');
    });
    return () => unsub();
  }, [enabled]);

  useEffect(() => {
    if (!enabled || !user) {
      setResumes([]);
      setSelectedId('');
      return;
    }

    const firestore = getFirestore();
    if (!firestore) return;

    const q = query(collection(firestore, 'users', user.uid, 'resumes'), orderBy('uploadDate', 'desc'));
    const unsub = onSnapshot(
      q,
      (snap) => {
        const rows = snap.docs.map(d => d.data() as CloudResumeDoc);
        setResumes(rows);
        if (!selectedId && rows[0]?.id) setSelectedId(rows[0].id);
      },
      (err) => {
        console.error(err);
        setSaveNote(String(err?.message || err));
      }
    );

    return () => unsub();
  }, [enabled, user, selectedId]);

  useEffect(() => {
    if (!selected) return;
    setDraftName(selected.name || 'Resume');
    setDraftText(selected.parsedText || '');
    setSaveNote('');
  }, [selected?.id]);

  const doSignIn = async () => {
    setAuthError('');
    try {
      const firebaseAuth = getFirebaseAuth();
      if (!firebaseAuth) throw new Error('Firebase is not configured.');
      await signInWithEmailAndPassword(firebaseAuth, email.trim(), password);
    } catch (e: any) {
      setAuthError(e?.message || 'Sign-in failed');
    }
  };

  const doSignUp = async () => {
    setAuthError('');
    try {
      const firebaseAuth = getFirebaseAuth();
      const firestore = getFirestore();
      if (!firebaseAuth || !firestore) throw new Error('Firebase is not configured.');

      const em = email.trim();
      if (!em) throw new Error('Email is required');
      if (!password) throw new Error('Password is required');
      if (password !== confirmPassword) throw new Error('Passwords do not match');

      const cred = await createUserWithEmailAndPassword(firebaseAuth, em, password);

      const name = displayName.trim();
      if (name) {
        await updateProfile(cred.user, { displayName: name });
      }

      await setDoc(
        doc(firestore, 'users', cred.user.uid),
        {
          uid: cred.user.uid,
          email: em,
          displayName: name || null,
          createdAt: serverTimestamp(),
        },
        { merge: true }
      );
    } catch (e: any) {
      setAuthError(e?.message || 'Sign-up failed');
    }
  };

  const doSignOut = async () => {
    const firebaseAuth = getFirebaseAuth();
    if (!firebaseAuth) return;
    await signOut(firebaseAuth);
  };

  const queueSave = () => {
    if (!enabled || !user || !selected) return;

    const firestore = getFirestore();
    if (!firestore) return;

    if (saveTimer.current) window.clearTimeout(saveTimer.current);
    saveTimer.current = window.setTimeout(async () => {
      setSaving(true);
      try {
        await setDoc(
          doc(firestore, 'users', user.uid, 'resumes', selected.id),
          {
            id: selected.id,
            name: draftName,
            parsedText: draftText,
            isDefault: selected.isDefault,
            uploadDate: selected.uploadDate,
            updatedAt: serverTimestamp(),
          },
          { merge: true }
        );
        setSaveNote('Saved');
      } catch (e: any) {
        console.error(e);
        setSaveNote(e?.message || 'Save failed');
      } finally {
        setSaving(false);
      }
    }, 650);
  };

  const setAsDefault = async () => {
    if (!enabled || !user || !selected) return;
    const firestore = getFirestore();
    if (!firestore) return;
    setSaving(true);
    try {
      // Mark selected default; (for simplicity) we do not fan-out updates to other docs here.
      // Extension will enforce one-default locally on pull.
      await setDoc(
        doc(firestore, 'users', user.uid, 'resumes', selected.id),
        {
          isDefault: true,
          updatedAt: serverTimestamp(),
        },
        { merge: true }
      );
      setSaveNote('Marked as default');
    } catch (e: any) {
      setSaveNote(e?.message || 'Failed');
    } finally {
      setSaving(false);
    }
  };

  if (!enabled) {
    return (
      <div className="web-shell">
        <div className="header web-header">
          <div className="topbar">
            <div className="topbar-left">
              <h1 className="topbar-title">ATS Resume Tracker — Web</h1>
              <p className="topbar-subtitle">Cloud resume editor</p>
            </div>
          </div>
        </div>
        <div className="web-content">
          <div className="alert warning">
            <span className="alert-icon">⚠️</span>
            <div>
              <strong>Firebase is not configured</strong>
              <p>Set Firebase env vars (see README) and rebuild.</p>
            </div>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="web-shell">
      <div className="header web-header">
        <div className="topbar">
          <div className="topbar-left">
            <h1 className="topbar-title">ATS Resume Tracker — Web</h1>
            <p className="topbar-subtitle">Edit resume text in real-time</p>
          </div>
          <div className="topbar-actions">
            {user ? (
              <span className="pill" title="Signed in">
                <span className="pill-dot" />
                {user.email || 'Signed in'}
              </span>
            ) : (
              <span className="pill" title="Not signed in">
                <span className="pill-dot warning" />
                Signed out
              </span>
            )}
          </div>
        </div>
      </div>

      <div className="web-content">
        {!user ? (
          <div className="status-card" style={{ maxWidth: 520, margin: '0 auto' }}>
            <div style={{ display: 'flex', gap: 10, marginBottom: 12 }}>
              <button
                className={`btn ${authMode === 'signin' ? 'btn-primary' : 'btn-secondary'}`}
                style={{ flex: 1 }}
                onClick={() => {
                  setAuthMode('signin');
                  setAuthError('');
                }}
              >
                Sign in
              </button>
              <button
                className={`btn ${authMode === 'signup' ? 'btn-primary' : 'btn-secondary'}`}
                style={{ flex: 1 }}
                onClick={() => {
                  setAuthMode('signup');
                  setAuthError('');
                }}
              >
                Create account
              </button>
            </div>

            {authMode === 'signup' && (
              <div className="form-group">
                <label className="form-label">Full name (optional)</label>
                <input className="form-input" value={displayName} onChange={(e) => setDisplayName(e.target.value)} placeholder="Your name" />
              </div>
            )}
            <div className="form-group">
              <label className="form-label">Email</label>
              <input className="form-input" value={email} onChange={(e) => setEmail(e.target.value)} placeholder="you@example.com" />
            </div>
            <div className="form-group">
              <label className="form-label">Password</label>
              <input className="form-input" type="password" value={password} onChange={(e) => setPassword(e.target.value)} placeholder="••••••••" />
            </div>

            {authMode === 'signup' && (
              <div className="form-group">
                <label className="form-label">Confirm password</label>
                <input className="form-input" type="password" value={confirmPassword} onChange={(e) => setConfirmPassword(e.target.value)} placeholder="••••••••" />
              </div>
            )}

            {authError && (
              <div className="alert warning" style={{ marginTop: 12 }}>
                <span className="alert-icon">⚠️</span>
                <div>
                  <strong>Auth error</strong>
                  <p>{authError}</p>
                </div>
              </div>
            )}

            <div style={{ marginTop: 12 }}>
              <button
                className="btn btn-primary btn-block"
                onClick={() => void (authMode === 'signin' ? doSignIn() : doSignUp())}
              >
                {authMode === 'signin' ? 'Sign in' : 'Create account'}
              </button>
            </div>

            <div style={{ marginTop: 12, fontSize: 12, color: 'var(--muted)' }}>
              Use the same account inside the extension (Settings → Cloud Sync) to share data.
            </div>
          </div>
        ) : (
          <>
            <div className="status-card" style={{ marginBottom: 14 }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', gap: 12, alignItems: 'center' }}>
                <div>
                  <div style={{ fontWeight: 800, marginBottom: 4 }}>Account</div>
                  <div className="code">UID: {user.uid}</div>
                </div>
                <button className="btn btn-secondary btn-sm" onClick={() => void doSignOut()}>Sign out</button>
              </div>
            </div>

            <div className="web-grid">
              <div className="status-card">
                <div style={{ fontWeight: 800, marginBottom: 10 }}>Resumes</div>
                {resumes.length === 0 ? (
                  <div className="empty-state">
                    <div className="empty-state-icon">📄</div>
                    <p>No resumes in cloud yet</p>
                    <p style={{ color: 'var(--muted)', fontSize: 12 }}>Upload a resume in the extension and click Push.</p>
                  </div>
                ) : (
                  <div style={{ display: 'grid', gap: 10 }}>
                    {resumes.map((r) => (
                      <button
                        key={r.id}
                        className={`list-item ${r.id === selectedId ? 'active' : ''}`}
                        style={{ textAlign: 'left', cursor: 'pointer' }}
                        onClick={() => setSelectedId(r.id)}
                      >
                        <div className="list-item-content">
                          <h4 style={{ margin: 0 }}>{r.name}</h4>
                          <p style={{ margin: 0 }}>{r.isDefault ? 'Default' : '—'} • {new Date(r.uploadDate).toLocaleDateString()}</p>
                        </div>
                      </button>
                    ))}
                  </div>
                )}
              </div>

              <div className="status-card">
                <div style={{ display: 'flex', justifyContent: 'space-between', gap: 12, alignItems: 'center', marginBottom: 10 }}>
                  <div>
                    <div style={{ fontWeight: 800 }}>Editor</div>
                    <div style={{ fontSize: 12, color: 'var(--muted)' }}>
                      {saving ? 'Saving…' : saveNote || 'Auto-saves while you type'}
                    </div>
                  </div>
                  <button className="btn btn-secondary btn-sm" onClick={() => void setAsDefault()} disabled={!selected}>Set default</button>
                </div>

                {!selected ? (
                  <div className="empty-state">
                    <div className="empty-state-icon">✏️</div>
                    <p>Select a resume to edit</p>
                  </div>
                ) : (
                  <>
                    <div className="form-group">
                      <label className="form-label">Name</label>
                      <input
                        className="form-input"
                        value={draftName}
                        onChange={(e) => {
                          setDraftName(e.target.value);
                          queueSave();
                        }}
                      />
                    </div>

                    <div className="form-group">
                      <label className="form-label">Resume text (ATS / formatting)</label>
                      <textarea
                        className="form-input textarea"
                        value={draftText}
                        onChange={(e) => {
                          setDraftText(e.target.value);
                          queueSave();
                        }}
                      />
                    </div>
                  </>
                )}
              </div>
            </div>
          </>
        )}
      </div>
    </div>
  );
};

ReactDOM.createRoot(document.getElementById('root')!).render(<App />);
