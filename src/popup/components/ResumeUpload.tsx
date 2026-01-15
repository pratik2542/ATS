import React, { useState, useRef } from 'react';
import { Resume } from '../../types';
import { tryCloudSyncResume } from '../../firebase/sync';
import { isCloudinaryEnabled, uploadFileToCloudinary } from '../../cloudinary/cloudinary';
import { extractTextFromDocxArrayBuffer, isDocxFile } from '../utils/docx';

interface ResumeUploadProps {
  onBack: () => void;
  onResumeUploaded: (resume: Resume) => void;
}

const ResumeUpload: React.FC<ResumeUploadProps> = ({ onBack, onResumeUploaded }) => {
  const [uploading, setUploading] = useState(false);
  const [dragging, setDragging] = useState(false);
  const [error, setError] = useState<string>('');
  const fileInputRef = useRef<HTMLInputElement>(null);

  const handleFileSelect = async (file: File) => {
    if (!file) return;

    if (!isDocxFile(file)) {
      setError('Please upload a .docx file');
      return;
    }

    if (file.size > 10 * 1024 * 1024) { // 10MB limit
      setError('File size must be less than 10MB');
      return;
    }

    setUploading(true);
    setError('');

    try {
      // Read file as base64
      const [fileContent, parsedText, cloud] = await Promise.all([
        readFileAsBase64(file),
        parseDocxText(file),
        (async () => {
          if (!isCloudinaryEnabled()) return null;
          try {
            return await uploadFileToCloudinary(file, {
              folder: 'ats-resumes',
              tags: ['ats-resume-tracker'],
            });
          } catch (e) {
            console.warn('Cloudinary upload failed:', e);
            return null;
          }
        })(),
      ]);

      const resume: Resume = {
        id: generateId(),
        name: file.name.replace(/\.docx$/i, ''),
        content: fileContent,
        parsedText: parsedText,
        uploadDate: Date.now(),
        isDefault: true,

        originalFileUrl: cloud?.secureUrl,
        originalFileProvider: cloud ? 'cloudinary' : undefined,
        originalFilePublicId: cloud?.publicId,
        originalFileMimeType: file.type || undefined,
        originalFileName: file.name || undefined,
      };

      // Save to storage
      chrome.storage.local.get(['resumes'], (result) => {
        const resumes: Resume[] = result.resumes || [];
        
        // Mark all other resumes as not default
        resumes.forEach(r => r.isDefault = false);
        
        resumes.push(resume);
        
        chrome.storage.local.set({ resumes }, () => {
          setUploading(false);
          onResumeUploaded(resume);

          // Fire-and-forget cloud sync (does not block UX)
          void tryCloudSyncResume(resume).catch((e) => console.warn('Cloud sync (resume) failed:', e));
        });
      });
    } catch (err) {
      setError((err as Error).message || 'Failed to upload resume');
      setUploading(false);
    }
  };

  const readFileAsBase64 = (file: File): Promise<string> => {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => {
        const base64 = (reader.result as string).split(',')[1];
        resolve(base64);
      };
      reader.onerror = reject;
      reader.readAsDataURL(file);
    });
  };

  const parseDocxText = async (file: File): Promise<string> => {
    try {
      const arrayBuffer = await file.arrayBuffer();
      const { text } = await extractTextFromDocxArrayBuffer(arrayBuffer);
      return text;
    } catch (err) {
      console.error('DOCX parsing error:', err);
      return 'Resume uploaded, but DOCX text extraction failed. Please try a different .docx file.';
    }
  };

  const generateId = (): string => {
    return `${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
  };

  const handleDragOver = (e: React.DragEvent) => {
    e.preventDefault();
    setDragging(true);
  };

  const handleDragLeave = () => {
    setDragging(false);
  };

  const handleDrop = (e: React.DragEvent) => {
    e.preventDefault();
    setDragging(false);
    
    const file = e.dataTransfer.files[0];
    if (file) {
      handleFileSelect(file);
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
            <h1 className="topbar-title">Upload Resume</h1>
            <p className="topbar-subtitle">DOCX → stored locally</p>
          </div>
          <div className="topbar-actions">
            <span className="pill" title="File constraints">
              <span className="pill-dot" />
              DOCX • 10MB
            </span>
          </div>
        </div>
      </div>

      <div className="content">
        {error && (
          <div className="alert warning">
            <span className="alert-icon">⚠️</span>
            <div>
              <strong>Error</strong>
              <p>{error}</p>
            </div>
          </div>
        )}

        {uploading ? (
          <div className="status-card">
            <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
              <div className="spinner" />
              <div style={{ display: 'grid', gap: '6px' }}>
                <div style={{ fontWeight: 800 }}>Processing…</div>
                <div style={{ fontSize: '12px', color: 'var(--muted)' }}>Extracting text and saving as default resume.</div>
              </div>
            </div>
            <div style={{ marginTop: '12px' }} className="progress">
              <span style={{ width: '70%' }} />
            </div>
          </div>
        ) : (
          <>
            <div
              className={`file-upload-area ${dragging ? 'dragging' : ''}`}
              onClick={() => fileInputRef.current?.click()}
              onDragOver={handleDragOver}
              onDragLeave={handleDragLeave}
              onDrop={handleDrop}
            >
              <div className="upload-icon">📄</div>
              <p>Drop a DOCX here or click to browse</p>
              <small>Stored locally • Used for analysis</small>
            </div>

            <input
              ref={fileInputRef}
              type="file"
              className="file-input"
              accept=".docx"
              onChange={(e) => {
                const file = e.target.files?.[0];
                if (file) handleFileSelect(file);
              }}
            />

            <div className="status-card" style={{ marginTop: '14px' }}>
              <div style={{ fontWeight: 800, marginBottom: '8px' }}>💡 Tips for best results</div>
              <div className="chip-row" style={{ marginBottom: '10px' }}>
                <span className="chip">Clear headings</span>
                <span className="chip">Real .docx (not scanned)</span>
                <span className="chip">Skills section</span>
                <span className="chip">One page OK</span>
              </div>
              <ul style={{ fontSize: '13px', color: 'var(--muted)', lineHeight: '1.8', paddingLeft: '20px', margin: 0 }}>
                <li>Use standard fonts and avoid images for text.</li>
                <li>Include measurable impact (numbers, outcomes).</li>
                <li>Keep keywords aligned with target job roles.</li>
              </ul>
            </div>
          </>
        )}
      </div>
    </div>
  );
};

export default ResumeUpload;
