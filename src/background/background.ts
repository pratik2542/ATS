// Background Service Worker - Handles extension lifecycle and message routing

chrome.runtime.onInstalled.addListener(() => {
  console.log('ATS Resume Tracker installed');
  
  // Initialize storage with default structure
  chrome.storage.local.get(['resumes'], (result) => {
    if (!result.resumes) {
      chrome.storage.local.set({
        resumes: [],
        jobs: [],
        applications: [],
        coverLetters: [],
        optimizedResumes: []
      });
    }
  });
});

// Listen for messages from content scripts and popup
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  console.log('Background received message:', message);

  switch (message.type) {
    case 'EXTRACT_JOB':
      handleJobExtraction(message.payload, sendResponse);
      return true; // Keep channel open for async response

    case 'ANALYZE_RESUME':
      handleResumeAnalysis(message.payload, sendResponse);
      return true;

    case 'GENERATE_RESUME':
      handleResumeGeneration(message.payload, sendResponse);
      return true;

    case 'GENERATE_COVER_LETTER':
      handleCoverLetterGeneration(message.payload, sendResponse);
      return true;

    case 'GET_CURRENT_TAB':
      chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
        sendResponse({ url: tabs[0]?.url });
      });
      return true;
  }
});

async function handleJobExtraction(payload: any, sendResponse: (response: any) => void) {
  try {
    // The job data is already extracted by content script
    const job = payload.job;
    
    // Save job to storage
    chrome.storage.local.get(['jobs'], (result) => {
      const jobs = result.jobs || [];
      const existingJobIndex = jobs.findIndex((j: any) => j.url === job.url);
      
      if (existingJobIndex >= 0) {
        jobs[existingJobIndex] = job;
      } else {
        jobs.push(job);
      }
      
      chrome.storage.local.set({ jobs }, () => {
        sendResponse({ success: true, job });
      });
    });
  } catch (error) {
    sendResponse({ success: false, error: (error as Error).message });
  }
}

async function handleResumeAnalysis(payload: any, sendResponse: (response: any) => void) {
  try {
    const { resume, job, apiKey, provider } = payload;
    
    // Call AI API for analysis
    const analysis = await analyzeWithAI(resume, job, apiKey, provider);
    
    sendResponse({ success: true, analysis });
  } catch (error) {
    sendResponse({ success: false, error: (error as Error).message });
  }
}

async function handleResumeGeneration(payload: any, sendResponse: (response: any) => void) {
  try {
    const { resume, job, analysis, apiKey, provider } = payload;
    
    // Call AI API for resume optimization
    const optimizedResume = await generateOptimizedResume(resume, job, analysis, apiKey, provider);
    
    sendResponse({ success: true, optimizedResume });
  } catch (error) {
    sendResponse({ success: false, error: (error as Error).message });
  }
}

async function handleCoverLetterGeneration(payload: any, sendResponse: (response: any) => void) {
  try {
    const { resume, job, apiKey, provider } = payload;
    
    // Call AI API for cover letter generation
    const coverLetter = await generateCoverLetter(resume, job, apiKey, provider);
    
    sendResponse({ success: true, coverLetter });
  } catch (error) {
    sendResponse({ success: false, error: (error as Error).message });
  }
}

// AI Analysis Functions
async function analyzeWithAI(resume: any, job: any, apiKey: string, provider: 'openai' | 'gemini') {
  const prompt = `You are an ATS (Applicant Tracking System) expert. Analyze the following resume against the job description and provide detailed feedback.

Resume:
${resume.parsedText}

Job Description:
${job.description}

Provide your analysis in the following JSON format:
{
  "score": <number 0-100>,
  "matchedKeywords": [<array of matched keywords from job description>],
  "missingKeywords": [<array of important keywords missing from resume>],
  "matchedSkills": [<array of matched skills>],
  "missingSkills": [<array of missing skills that are required>],
  "suggestions": [<array of specific actionable suggestions to improve the resume>],
  "sections": [
    {
      "name": "<section name like Experience, Skills, Education>",
      "score": <number 0-100>,
      "feedback": "<specific feedback for this section>"
    }
  ]
}`;

  let response = await callAI(prompt, apiKey, provider);
  
  // Clean up code blocks if present (Gemini loves markdown)
  response = response.replace(/^```json\n?/, '').replace(/\n?```$/, '').trim();
  
  return JSON.parse(response);
}

async function generateOptimizedResume(resume: any, job: any, analysis: any, apiKey: string, provider: 'openai' | 'gemini') {
  const prompt = `You are an expert resume writer. Based on the analysis below, modify the resume to better match the job description while keeping the core information truthful.

Original Resume:
${resume.parsedText}

Job Description:
${job.description}

Analysis:
${JSON.stringify(analysis, null, 2)}

Instructions:
1. Add missing keywords naturally where appropriate
2. Highlight relevant experience that matches job requirements
3. Reorganize or rephrase bullet points to emphasize matching skills
4. Keep all information truthful - only rephrase, don't fabricate
5. Maintain professional formatting

Provide the optimized resume content as plain text.`;

  return await callAI(prompt, apiKey, provider);
}

async function generateCoverLetter(resume: any, job: any, apiKey: string, provider: 'openai' | 'gemini') {
  const prompt = `You are an expert cover letter writer. Create a compelling, personalized cover letter for this job application.

Resume Summary:
${resume.parsedText.substring(0, 1000)}

Job Title: ${job.title}
Company: ${job.company}
Job Description:
${job.description}

Instructions:
1. Create a professional cover letter (3-4 paragraphs)
2. Highlight relevant experience from the resume
3. Show enthusiasm for the role and company
4. Explain why the candidate is a great fit
5. Use a professional but warm tone
6. Keep it concise (under 400 words)

Provide only the cover letter content without any additional commentary.`;

  return await callAI(prompt, apiKey, provider);
}

async function callAI(prompt: string, apiKey: string, provider: 'openai' | 'gemini' = 'openai'): Promise<string> {
  if (provider === 'gemini') {
    return await callGemini(prompt, apiKey);
  } else {
    return await callOpenAI(prompt, apiKey);
  }
}

async function callOpenAI(prompt: string, apiKey: string): Promise<string> {
  const response = await fetch('https://api.openai.com/v1/chat/completions', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${apiKey}`
    },
    body: JSON.stringify({
      model: 'gpt-4-turbo-preview',
      messages: [
        {
          role: 'system',
          content: 'You are an expert ATS system and career advisor. Provide precise, actionable advice.'
        },
        {
          role: 'user',
          content: prompt
        }
      ],
      temperature: 0.7,
      max_tokens: 2000
    })
  });

  if (!response.ok) {
    throw new Error(`OpenAI API error: ${response.statusText}`);
  }

  const data = await response.json();
  return data.choices[0].message.content;
}

async function callGemini(prompt: string, apiKey: string): Promise<string> {
  const response = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent?key=${apiKey}`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({
      contents: [{
        parts: [{
          text: prompt
        }]
      }]
    })
  });

  if (!response.ok) {
    const errorData = await response.json();
    throw new Error(`Gemini API error: ${errorData.error?.message || response.statusText}`);
  }

  const data = await response.json();
  return data.candidates[0].content.parts[0].text;
}

export {};
