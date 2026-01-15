// Storage utility functions for ATS Resume Tracker

import { Resume, JobPosting, Application, CoverLetter, OptimizedResume, StorageData } from '../types';

export class StorageManager {
  private static STORAGE_VERSION = '1.0';

  // Initialize storage with default structure
  static async initialize(): Promise<void> {
    const data = await chrome.storage.local.get(null);
    
    if (!data.version) {
      await chrome.storage.local.set({
        version: this.STORAGE_VERSION,
        resumes: [],
        jobs: [],
        applications: [],
        coverLetters: [],
        optimizedResumes: [],
        apiKey: ''
      });
    }
  }

  // Resume operations
  static async saveResume(resume: Resume): Promise<void> {
    const { resumes = [] } = await chrome.storage.local.get(['resumes']);
    
    // If setting as default, unset other defaults
    if (resume.isDefault) {
      resumes.forEach((r: Resume) => r.isDefault = false);
    }
    
    resumes.push(resume);
    await chrome.storage.local.set({ resumes });
  }

  static async getResumes(): Promise<Resume[]> {
    const { resumes = [] } = await chrome.storage.local.get(['resumes']);
    return resumes;
  }

  static async getDefaultResume(): Promise<Resume | null> {
    const resumes = await this.getResumes();
    return resumes.find(r => r.isDefault) || null;
  }

  static async deleteResume(id: string): Promise<void> {
    const { resumes = [] } = await chrome.storage.local.get(['resumes']);
    const filtered = resumes.filter((r: Resume) => r.id !== id);
    await chrome.storage.local.set({ resumes: filtered });
  }

  // Job operations
  static async saveJob(job: JobPosting): Promise<void> {
    const { jobs = [] } = await chrome.storage.local.get(['jobs']);
    
    // Check if job already exists (by URL)
    const existingIndex = jobs.findIndex((j: JobPosting) => j.url === job.url);
    
    if (existingIndex >= 0) {
      jobs[existingIndex] = job;
    } else {
      jobs.push(job);
    }
    
    await chrome.storage.local.set({ jobs });
  }

  static async getJobs(): Promise<JobPosting[]> {
    const { jobs = [] } = await chrome.storage.local.get(['jobs']);
    return jobs;
  }

  static async getJob(id: string): Promise<JobPosting | null> {
    const jobs = await this.getJobs();
    return jobs.find(j => j.id === id) || null;
  }

  // Application operations
  static async saveApplication(application: Application): Promise<void> {
    const { applications = [] } = await chrome.storage.local.get(['applications']);
    applications.push(application);
    await chrome.storage.local.set({ applications });
  }

  static async getApplications(): Promise<Application[]> {
    const { applications = [] } = await chrome.storage.local.get(['applications']);
    return applications;
  }

  static async updateApplicationStatus(id: string, status: Application['status']): Promise<void> {
    const { applications = [] } = await chrome.storage.local.get(['applications']);
    const app = applications.find((a: Application) => a.id === id);
    
    if (app) {
      app.status = status;
      await chrome.storage.local.set({ applications });
    }
  }

  // Cover letter operations
  static async saveCoverLetter(coverLetter: CoverLetter): Promise<void> {
    const { coverLetters = [] } = await chrome.storage.local.get(['coverLetters']);
    coverLetters.push(coverLetter);
    await chrome.storage.local.set({ coverLetters });
  }

  static async getCoverLetters(): Promise<CoverLetter[]> {
    const { coverLetters = [] } = await chrome.storage.local.get(['coverLetters']);
    return coverLetters;
  }

  // Optimized resume operations
  static async saveOptimizedResume(resume: OptimizedResume): Promise<void> {
    const { optimizedResumes = [] } = await chrome.storage.local.get(['optimizedResumes']);
    optimizedResumes.push(resume);
    await chrome.storage.local.set({ optimizedResumes });
  }

  static async getOptimizedResumes(): Promise<OptimizedResume[]> {
    const { optimizedResumes = [] } = await chrome.storage.local.get(['optimizedResumes']);
    return optimizedResumes;
  }

  // API Key operations
  static async saveApiKey(apiKey: string): Promise<void> {
    await chrome.storage.local.set({ apiKey });
  }

  static async getApiKey(): Promise<string> {
    const { apiKey = '' } = await chrome.storage.local.get(['apiKey']);
    return apiKey;
  }

  // Clear all data
  static async clearAll(): Promise<void> {
    await chrome.storage.local.clear();
    await this.initialize();
  }

  // Export data
  static async exportData(): Promise<StorageData> {
    const data = await chrome.storage.local.get(null);
    return data as StorageData;
  }

  // Import data
  static async importData(data: Partial<StorageData>): Promise<void> {
    await chrome.storage.local.set(data);
  }

  // Get storage usage
  static async getStorageInfo(): Promise<{ bytesInUse: number; quota: number }> {
    return new Promise((resolve) => {
      chrome.storage.local.getBytesInUse(null, (bytesInUse) => {
        resolve({
          bytesInUse,
          quota: chrome.storage.local.QUOTA_BYTES || 5242880 // 5MB default
        });
      });
    });
  }
}
