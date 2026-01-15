import {
  collection,
  deleteDoc,
  doc,
  getDocs,
  serverTimestamp,
  setDoc,
} from 'firebase/firestore';

import type { Application, CoverLetter, OptimizedResume, Resume, JobPosting } from '../types';
import { getFirebaseAuth, getFirestore, isFirebaseEnabled } from './firebase';

type CloudSyncState = {
  uid?: string;
  enabled?: boolean;
  lastPushAt?: number;
  lastPullAt?: number;
  lastError?: string;
  lastErrorAt?: number;
};

const updateCloudSyncState = async (patch: CloudSyncState): Promise<void> => {
  const existing = await chrome.storage.local.get(['cloudSync']);
  const prev: CloudSyncState = existing.cloudSync || {};
  const next: CloudSyncState = {
    ...prev,
    ...patch,
    enabled: isFirebaseEnabled(),
  };
  await chrome.storage.local.set({ cloudSync: next });
};

// We preserve the original resume file format by storing a Cloudinary URL.
// Older versions stored base64 PDFs in Firestore chunk documents; pull remains
// backward-compatible for those older records.

const ensureUser = async (): Promise<string> => {
  const firebaseAuth = getFirebaseAuth();
  if (!firebaseAuth) throw new Error('Firebase is not configured. Add Firebase env vars and rebuild.');

  if (!firebaseAuth.currentUser) {
    throw new Error(
      'Cloud sync requires sign-in. Go to Settings → Cloud Sync Account and sign in (or tap Continue as guest) first.'
    );
  }
  const uid = firebaseAuth.currentUser?.uid;
  if (!uid) throw new Error('Firebase auth failed');
  await updateCloudSyncState({ uid });
  return uid;
};

export const tryCloudSyncResume = async (resume: Resume): Promise<void> => {
  if (!isFirebaseEnabled()) return;

  const firestore = getFirestore();
  if (!firestore) throw new Error('Firebase is not configured. Add Firebase env vars and rebuild.');

  const uid = await ensureUser();

  await setDoc(
    doc(firestore, 'users', uid, 'resumes', resume.id),
    {
      id: resume.id,
      name: resume.name,
      uploadDate: resume.uploadDate,
      isDefault: resume.isDefault,
      parsedText: resume.parsedText,
      originalFileUrl: resume.originalFileUrl || null,
      originalFileProvider: resume.originalFileProvider || null,
      originalFilePublicId: resume.originalFilePublicId || null,
      originalFileMimeType: resume.originalFileMimeType || null,
      originalFileName: resume.originalFileName || null,
      updatedAt: serverTimestamp(),
    },
    { merge: true }
  );

  await updateCloudSyncState({ lastPushAt: Date.now(), lastError: undefined });
};

export const tryCloudSyncOptimizedResume = async (optimized: OptimizedResume): Promise<void> => {
  if (!isFirebaseEnabled()) return;

  const firestore = getFirestore();
  if (!firestore) throw new Error('Firebase is not configured. Add Firebase env vars and rebuild.');

  const uid = await ensureUser();

  await setDoc(
    doc(firestore, 'users', uid, 'optimizedResumes', optimized.id),
    {
      id: optimized.id,
      name: optimized.name,
      uploadDate: optimized.uploadDate,
      isDefault: optimized.isDefault,
      parsedText: optimized.parsedText,
      originalResumeId: optimized.originalResumeId,
      jobId: optimized.jobId,
      modifications: optimized.modifications,
      originalFileUrl: optimized.originalFileUrl || null,
      originalFileProvider: optimized.originalFileProvider || null,
      originalFilePublicId: optimized.originalFilePublicId || null,
      originalFileMimeType: optimized.originalFileMimeType || null,
      originalFileName: optimized.originalFileName || null,
      updatedAt: serverTimestamp(),
    },
    { merge: true }
  );

  await updateCloudSyncState({ lastPushAt: Date.now(), lastError: undefined });
};

export const tryCloudSyncCoverLetter = async (letter: CoverLetter): Promise<void> => {
  if (!isFirebaseEnabled()) return;

  const firestore = getFirestore();
  if (!firestore) throw new Error('Firebase is not configured. Add Firebase env vars and rebuild.');

  const uid = await ensureUser();

  await setDoc(
    doc(firestore, 'users', uid, 'coverLetters', letter.id),
    {
      id: letter.id,
      jobId: letter.jobId,
      content: letter.content,
      createdDate: letter.createdDate,
      updatedAt: serverTimestamp(),
    },
    { merge: true }
  );

  await updateCloudSyncState({ lastPushAt: Date.now(), lastError: undefined });
};

export const tryCloudSyncJob = async (job: JobPosting): Promise<void> => {
  if (!isFirebaseEnabled()) return;

  const firestore = getFirestore();
  if (!firestore) throw new Error('Firebase is not configured.');

  const uid = await ensureUser();

  await setDoc(
    doc(firestore, 'users', uid, 'jobs', job.id),
    {
      id: job.id,
      title: job.title,
      company: job.company,
      description: job.description,
      url: job.url,
      extractedDate: job.extractedDate,
      location: job.location || null,
      salary: job.salary || null,
      postedDate: job.postedDate || null,
      platform: job.platform || null,
      updatedAt: serverTimestamp(),
    },
    { merge: true }
  );

  await updateCloudSyncState({ lastPushAt: Date.now(), lastError: undefined });
};

export const tryCloudSyncApplication = async (application: Application): Promise<void> => {
  if (!isFirebaseEnabled()) return;

  const firestore = getFirestore();
  if (!firestore) throw new Error('Firebase is not configured. Add Firebase env vars and rebuild.');

  const uid = await ensureUser();

  await setDoc(
    doc(firestore, 'users', uid, 'applications', application.id),
    {
      id: application.id,
      jobId: application.jobId,
      resumeId: application.resumeId,
      coverLetterId: application.coverLetterId || null,
      appliedDate: application.appliedDate,
      status: application.status,
      updatedAt: serverTimestamp(),
    },
    { merge: true }
  );

  await updateCloudSyncState({ lastPushAt: Date.now(), lastError: undefined });
};

export const tryCloudDeleteOptimizedResume = async (id: string): Promise<void> => {
  if (!isFirebaseEnabled()) return;

  const firestore = getFirestore();
  if (!firestore) return;

  const uid = await ensureUser();
  await deleteDoc(doc(firestore, 'users', uid, 'optimizedResumes', id));
};

export const tryCloudDeleteCoverLetter = async (id: string): Promise<void> => {
  if (!isFirebaseEnabled()) return;

  const firestore = getFirestore();
  if (!firestore) return;

  const uid = await ensureUser();
  await deleteDoc(doc(firestore, 'users', uid, 'coverLetters', id));
};

export const tryCloudDeleteApplication = async (id: string): Promise<void> => {
  if (!isFirebaseEnabled()) return;

  const firestore = getFirestore();
  if (!firestore) return;

  const uid = await ensureUser();
  await deleteDoc(doc(firestore, 'users', uid, 'applications', id));
};

export const tryCloudPullAllToLocal = async (): Promise<void> => {
  if (!isFirebaseEnabled()) return;

  const firestore = getFirestore();
  if (!firestore) throw new Error('Firebase is not configured. Add Firebase env vars and rebuild.');

  try {
    const uid = await ensureUser();

    const [resumesSnap, optimizedSnap, lettersSnap, appsSnap, jobsSnap] = await Promise.all([
      getDocs(collection(firestore, 'users', uid, 'resumes')),
      getDocs(collection(firestore, 'users', uid, 'optimizedResumes')),
      getDocs(collection(firestore, 'users', uid, 'coverLetters')),
      getDocs(collection(firestore, 'users', uid, 'applications')),
      getDocs(collection(firestore, 'users', uid, 'jobs')),
    ]);

    const cloudResumes = resumesSnap.docs.map(d => d.data() as any);
    const cloudOptimized = optimizedSnap.docs.map(d => d.data() as any);
    const cloudLetters = lettersSnap.docs.map(d => d.data() as any);
    const cloudApps = appsSnap.docs.map(d => d.data() as any);
    const cloudJobs = jobsSnap.docs.map(d => d.data() as any);

    const local = await chrome.storage.local.get(['resumes', 'optimizedResumes', 'coverLetters', 'applications', 'jobs']);
    const resumes: Resume[] = local.resumes || [];
    const optimizedResumes: OptimizedResume[] = local.optimizedResumes || [];
    const coverLetters: CoverLetter[] = local.coverLetters || [];
    const applications: Application[] = local.applications || [];
    const jobs: JobPosting[] = local.jobs || [];

    const upsertById = <T extends { id: string }>(arr: T[], item: T) => {
      const idx = arr.findIndex(x => x.id === item.id);
      if (idx >= 0) arr[idx] = { ...arr[idx], ...item };
      else arr.push(item);
    };

    // Pull resumes; prefer original file URL (Cloudinary). If a resume has no
    // URL, fall back to legacy Firestore pdfChunks hydration.
    for (const r of cloudResumes) {
      const resume: Resume & { pdfChunkCount?: number } = {
        id: String(r.id),
        name: String(r.name || 'Resume'),
        content: '',
        parsedText: String(r.parsedText || ''),
        uploadDate: Number(r.uploadDate || Date.now()),
        isDefault: Boolean(r.isDefault),
        originalFileUrl: r.originalFileUrl ? String(r.originalFileUrl) : undefined,
        originalFileProvider: r.originalFileProvider ? 'cloudinary' : undefined,
        originalFilePublicId: r.originalFilePublicId ? String(r.originalFilePublicId) : undefined,
        originalFileMimeType: r.originalFileMimeType ? String(r.originalFileMimeType) : undefined,
        originalFileName: r.originalFileName ? String(r.originalFileName) : undefined,
        pdfChunkCount: typeof r.pdfChunkCount === 'number' ? r.pdfChunkCount : 0,
      };

      const existing = resumes.find(x => x.id === resume.id);
      if (existing?.content) {
        resume.content = existing.content;
      } else if (!resume.originalFileUrl && resume.pdfChunkCount && resume.pdfChunkCount > 0) {
        try {
          const chunksSnap = await getDocs(collection(firestore, 'users', uid, 'resumes', resume.id, 'pdfChunks'));
          const chunks = chunksSnap.docs
            .map(d => d.data() as any)
            .sort((a, b) => Number(a.i) - Number(b.i))
            .map(d => String(d.chunk || ''));
          resume.content = chunks.join('');
        } catch {
          // ok to keep empty
        }
      }

      upsertById(resumes, resume);
    }

    for (const o of cloudOptimized) {
      const optimized: OptimizedResume = {
        id: String(o.id),
        name: String(o.name || 'Optimized Resume'),
        content: '',
        parsedText: String(o.parsedText || ''),
        uploadDate: Number(o.uploadDate || Date.now()),
        isDefault: Boolean(o.isDefault),
        originalResumeId: String(o.originalResumeId || ''),
        jobId: String(o.jobId || ''),
        modifications: Array.isArray(o.modifications) ? o.modifications.map(String) : [],
        originalFileUrl: o.originalFileUrl ? String(o.originalFileUrl) : undefined,
        originalFileProvider: o.originalFileProvider ? 'cloudinary' : undefined,
        originalFilePublicId: o.originalFilePublicId ? String(o.originalFilePublicId) : undefined,
        originalFileMimeType: o.originalFileMimeType ? String(o.originalFileMimeType) : undefined,
        originalFileName: o.originalFileName ? String(o.originalFileName) : undefined,
      };
      upsertById(optimizedResumes, optimized);
    }

    for (const cl of cloudLetters) {
      const letter: CoverLetter = {
        id: String(cl.id),
        jobId: String(cl.jobId || ''),
        content: String(cl.content || ''),
        createdDate: Number(cl.createdDate || Date.now()),
      };
      upsertById(coverLetters, letter);
    }

    for (const a of cloudApps) {
      const app: Application = {
        id: String(a.id),
        jobId: String(a.jobId || ''),
        resumeId: String(a.resumeId || ''),
        coverLetterId: a.coverLetterId ? String(a.coverLetterId) : undefined,
        appliedDate: Number(a.appliedDate || Date.now()),
        status: (String(a.status || 'draft') as Application['status']),
      };
      upsertById(applications, app);
    }

    for (const j of cloudJobs) {
      const job: JobPosting = {
        id: String(j.id),
        title: String(j.title || ''),
        company: String(j.company || ''),
        description: String(j.description || ''),
        url: String(j.url || ''),
        extractedDate: Number(j.extractedDate || Date.now()),
        location: j.location ? String(j.location) : undefined,
        salary: j.salary ? String(j.salary) : undefined,
        postedDate: j.postedDate ? String(j.postedDate) : undefined,
        platform: j.platform ? String(j.platform) : undefined,
      };
      upsertById(jobs, job);
    }

    // If cloud has a default resume, enforce one-default locally.
    const cloudDefault = resumes.find(r => r.isDefault);
    if (cloudDefault) {
      resumes.forEach(r => (r.isDefault = r.id === cloudDefault.id));
    }

    await chrome.storage.local.set({ resumes, optimizedResumes, coverLetters, applications, jobs });
    await updateCloudSyncState({ lastPullAt: Date.now(), lastError: undefined });
  } catch (e) {
    await updateCloudSyncState({ lastError: (e as Error)?.message || String(e), lastErrorAt: Date.now() });
    throw e;
  }
};

export const tryCloudPushAllFromLocal = async (): Promise<void> => {
  if (!isFirebaseEnabled()) return;

  try {
    await ensureUser();
    const local = await chrome.storage.local.get(['resumes', 'optimizedResumes', 'coverLetters', 'applications', 'jobs']);

    const resumes: Resume[] = local.resumes || [];
    const optimizedResumes: OptimizedResume[] = local.optimizedResumes || [];
    const coverLetters: CoverLetter[] = local.coverLetters || [];
    const applications: Application[] = local.applications || [];
    const jobs: JobPosting[] = local.jobs || [];

    // Keep it simple/robust: sync sequentially to avoid request bursts.
    for (const r of resumes) await tryCloudSyncResume(r);
    for (const o of optimizedResumes) await tryCloudSyncOptimizedResume(o);
    for (const cl of coverLetters) await tryCloudSyncCoverLetter(cl);
    for (const a of applications) await tryCloudSyncApplication(a);
    for (const j of jobs) await tryCloudSyncJob(j);

    await updateCloudSyncState({ lastPushAt: Date.now(), lastError: undefined });
  } catch (e) {
    await updateCloudSyncState({ lastError: (e as Error)?.message || String(e), lastErrorAt: Date.now() });
    throw e;
  }
};
