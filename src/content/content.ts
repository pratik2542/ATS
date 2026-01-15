// Content Script - Extracts job descriptions from career pages

console.log('ATS Resume Tracker content script loaded');

let analysisPanel: HTMLDivElement | null = null;

// Listen for messages from popup
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message.type === 'REQUEST_JOB_EXTRACTION') {
    const jobData = extractJobDescription();
    sendResponse({ success: true, job: jobData });
  } else if (message.type === 'SHOW_ANALYSIS_PANEL') {
    showAnalysisPanel(message.payload);
    sendResponse({ success: true });
  }
  return true;
});

function extractJobDescription() {
  const url = window.location.href;
  let title = '';
  let company = '';
  let description = '';

  // Try to extract job title - common selectors
  const titleSelectors = [
    'h1[class*="job"]',
    'h1[class*="title"]',
    '[class*="job-title"]',
    '[class*="jobTitle"]',
    '[data-testid*="job-title"]',
    'h1',
    '.job-details-jobs-unified-top-card__job-title',
    '.jobs-unified-top-card__job-title'
  ];

  for (const selector of titleSelectors) {
    const element = document.querySelector(selector);
    if (element && element.textContent?.trim()) {
      title = element.textContent.trim();
      break;
    }
  }

  // Try to extract company name
  const companySelectors = [
    '[class*="company"]',
    '[class*="employer"]',
    '[data-testid*="company"]',
    '.job-details-jobs-unified-top-card__company-name',
    '.jobs-unified-top-card__company-name',
    'a[class*="company"]'
  ];

  for (const selector of companySelectors) {
    const element = document.querySelector(selector);
    if (element && element.textContent?.trim()) {
      company = element.textContent.trim();
      break;
    }
  }

  // Try to extract job description - look for the main content area
  const descriptionSelectors = [
    '[class*="description"]',
    '[class*="job-description"]',
    '[class*="jobDescription"]',
    '[id*="job-description"]',
    '[id*="jobDescription"]',
    '.jobs-description',
    '.show-more-less-html__markup',
    'article',
    'main'
  ];

  for (const selector of descriptionSelectors) {
    const element = document.querySelector(selector);
    if (element) {
      // Get text content, cleaning up extra whitespace
      let text = element.textContent || '';
      text = text.replace(/\s+/g, ' ').trim();
      if (text.length > 100) { // Must be substantial
        description = text;
        break;
      }
    }
  }

  // Fallback: get all visible text from body if description not found
  if (!description) {
    description = document.body.innerText.replace(/\s+/g, ' ').trim();
  }

  return {
    id: generateId(),
    title: title || 'Unknown Position',
    company: company || extractCompanyFromUrl(url),
    description: description,
    url: url,
    extractedDate: Date.now()
  };
}

function extractCompanyFromUrl(url: string): string {
  try {
    const hostname = new URL(url).hostname;
    const parts = hostname.split('.');
    if (parts.length >= 2) {
      return parts[parts.length - 2].charAt(0).toUpperCase() + parts[parts.length - 2].slice(1);
    }
  } catch (e) {
    console.error('Error extracting company from URL:', e);
  }
  return 'Unknown Company';
}

function generateId(): string {
  return `${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
}

function showAnalysisPanel(data: any) {
  // Remove existing panel if any
  if (analysisPanel) {
    analysisPanel.remove();
  }

  // Create floating panel
  analysisPanel = document.createElement('div');
  analysisPanel.id = 'ats-analysis-panel';
  analysisPanel.innerHTML = `
    <div class="ats-panel-header">
      <h3>ATS Analysis Results</h3>
      <button class="ats-close-btn">&times;</button>
    </div>
    <div class="ats-panel-content">
      <div class="ats-score">
        <div class="score-circle" style="background: conic-gradient(#4CAF50 ${data.analysis.score * 3.6}deg, #e0e0e0 0deg)">
          <div class="score-inner">
            <span class="score-number">${data.analysis.score}</span>
            <span class="score-label">ATS Score</span>
          </div>
        </div>
      </div>
      
      <div class="ats-section">
        <h4>✓ Matched Keywords (${data.analysis.matchedKeywords.length})</h4>
        <div class="keyword-list matched">
          ${data.analysis.matchedKeywords.map((k: string) => `<span class="keyword">${k}</span>`).join('')}
        </div>
      </div>
      
      <div class="ats-section">
        <h4>✗ Missing Keywords (${data.analysis.missingKeywords.length})</h4>
        <div class="keyword-list missing">
          ${data.analysis.missingKeywords.map((k: string) => `<span class="keyword">${k}</span>`).join('')}
        </div>
      </div>
      
      <div class="ats-section">
        <h4>💡 Suggestions</h4>
        <ul class="suggestions-list">
          ${data.analysis.suggestions.map((s: string) => `<li>${s}</li>`).join('')}
        </ul>
      </div>
      
      <div class="ats-actions">
        <button class="ats-btn primary" id="optimize-resume-btn">Optimize My Resume</button>
        <button class="ats-btn secondary" id="view-details-btn">View Full Details</button>
      </div>
    </div>
  `;

  // Add styles
  const style = document.createElement('style');
  style.textContent = `
    #ats-analysis-panel {
      position: fixed;
      top: 20px;
      right: 20px;
      width: 400px;
      max-height: 80vh;
      background: white;
      border-radius: 12px;
      box-shadow: 0 8px 32px rgba(0, 0, 0, 0.2);
      z-index: 999999;
      overflow: hidden;
      font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
    }
    
    .ats-panel-header {
      background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
      color: white;
      padding: 16px 20px;
      display: flex;
      justify-content: space-between;
      align-items: center;
    }
    
    .ats-panel-header h3 {
      margin: 0;
      font-size: 18px;
      font-weight: 600;
    }
    
    .ats-close-btn {
      background: none;
      border: none;
      color: white;
      font-size: 28px;
      cursor: pointer;
      padding: 0;
      width: 30px;
      height: 30px;
      line-height: 1;
    }
    
    .ats-panel-content {
      padding: 20px;
      max-height: calc(80vh - 60px);
      overflow-y: auto;
    }
    
    .ats-score {
      display: flex;
      justify-content: center;
      margin-bottom: 24px;
    }
    
    .score-circle {
      width: 120px;
      height: 120px;
      border-radius: 50%;
      display: flex;
      align-items: center;
      justify-content: center;
    }
    
    .score-inner {
      width: 100px;
      height: 100px;
      background: white;
      border-radius: 50%;
      display: flex;
      flex-direction: column;
      align-items: center;
      justify-content: center;
    }
    
    .score-number {
      font-size: 32px;
      font-weight: bold;
      color: #333;
    }
    
    .score-label {
      font-size: 12px;
      color: #666;
    }
    
    .ats-section {
      margin-bottom: 20px;
    }
    
    .ats-section h4 {
      font-size: 14px;
      font-weight: 600;
      margin: 0 0 10px 0;
      color: #333;
    }
    
    .keyword-list {
      display: flex;
      flex-wrap: wrap;
      gap: 6px;
    }
    
    .keyword {
      padding: 4px 10px;
      border-radius: 16px;
      font-size: 12px;
      font-weight: 500;
    }
    
    .keyword-list.matched .keyword {
      background: #e8f5e9;
      color: #2e7d32;
    }
    
    .keyword-list.missing .keyword {
      background: #ffebee;
      color: #c62828;
    }
    
    .suggestions-list {
      margin: 0;
      padding-left: 20px;
    }
    
    .suggestions-list li {
      font-size: 13px;
      color: #555;
      margin-bottom: 8px;
      line-height: 1.5;
    }
    
    .ats-actions {
      display: flex;
      gap: 10px;
      margin-top: 20px;
    }
    
    .ats-btn {
      flex: 1;
      padding: 12px;
      border: none;
      border-radius: 8px;
      font-size: 14px;
      font-weight: 600;
      cursor: pointer;
      transition: all 0.2s;
    }
    
    .ats-btn.primary {
      background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
      color: white;
    }
    
    .ats-btn.primary:hover {
      transform: translateY(-2px);
      box-shadow: 0 4px 12px rgba(102, 126, 234, 0.4);
    }
    
    .ats-btn.secondary {
      background: white;
      color: #667eea;
      border: 2px solid #667eea;
    }
    
    .ats-btn.secondary:hover {
      background: #f5f7ff;
    }
  `;

  document.head.appendChild(style);
  document.body.appendChild(analysisPanel);

  // Add event listeners
  const closeBtn = analysisPanel.querySelector('.ats-close-btn');
  closeBtn?.addEventListener('click', () => {
    analysisPanel?.remove();
  });

  const optimizeBtn = analysisPanel.querySelector('#optimize-resume-btn');
  optimizeBtn?.addEventListener('click', () => {
    chrome.runtime.sendMessage({ type: 'OPEN_OPTIMIZATION', payload: data });
  });

  const detailsBtn = analysisPanel.querySelector('#view-details-btn');
  detailsBtn?.addEventListener('click', () => {
    chrome.runtime.sendMessage({ type: 'OPEN_FULL_ANALYSIS', payload: data });
  });
}

export {};
