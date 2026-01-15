import React from 'react';
import ReactDOM from 'react-dom/client';

// Full analysis page (optional - for detailed view)
const AnalysisPage: React.FC = () => {
  return (
    <div style={{ padding: '40px' }}>
      <h1>Full ATS Analysis</h1>
      <p>Detailed analysis view - to be implemented based on needs</p>
    </div>
  );
};

const root = ReactDOM.createRoot(document.getElementById('root')!);
root.render(<AnalysisPage />);
