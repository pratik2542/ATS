// Type definitions for the ATS Resume Tracker

export interface Resume {
  id: string;
  name: string;
  content: string;
  parsedText: string;
  uploadDate: number;
  isDefault: boolean;

  // Optional: preserve the original uploaded file format via a cloud URL.
  originalFileUrl?: string;
  originalFileProvider?: 'cloudinary';
  originalFilePublicId?: string;
  originalFileMimeType?: string;
  originalFileName?: string;
}

export interface JobPosting {
  id: string;
  title: string;
  company: string;
  description: string;
  url: string;
  extractedDate: number;
  location?: string;
  salary?: string;
  postedDate?: string;
  platform?: string;
}

export interface ATSAnalysis {
  score: number;
  matchedKeywords: string[];
  missingKeywords: string[];
  matchedSkills: string[];
  missingSkills: string[];
  suggestions: string[];
  sections: {
    name: string;
    score: number;
    feedback: string;
  }[];
}

export interface Application {
  id: string;
  jobId: string;
  resumeId: string;
  coverLetterId?: string;
  appliedDate: number;
  status: 'draft' | 'applied' | 'interviewing' | 'rejected' | 'accepted';
}

export interface CoverLetter {
  id: string;
  jobId: string;
  content: string;
  createdDate: number;
}

export interface OptimizedResume extends Resume {
  originalResumeId: string;
  jobId: string;
  modifications: string[];
}

export interface StorageData {
  resumes: Resume[];
  jobs: JobPosting[];
  applications: Application[];
  coverLetters: CoverLetter[];
  optimizedResumes: OptimizedResume[];
  apiKey?: string;
}

export interface Message {
  type: 'EXTRACT_JOB' | 'ANALYZE_RESUME' | 'GENERATE_RESUME' | 'GENERATE_COVER_LETTER' | 'SAVE_APPLICATION';
  payload?: any;
}

export interface AnalysisRequest {
  resume: Resume;
  job: JobPosting;
  apiKey: string;
}

export interface OptimizationRequest {
  resume: Resume;
  job: JobPosting;
  analysis: ATSAnalysis;
  apiKey: string;
}

export interface CoverLetterRequest {
  resume: Resume;
  job: JobPosting;
  apiKey: string;
}
