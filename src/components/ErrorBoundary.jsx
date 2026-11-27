import { Component } from 'react';
import { STORAGE_KEY } from '../domain/constants.js';

function downloadRawLocalStorageBackup() {
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    const content = raw || JSON.stringify({ note: 'No saved tracker state found.' }, null, 2);
    const blob = new Blob([content], { type: 'application/json;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = `grade-tracker-backup-${new Date().toISOString().slice(0, 10)}.json`;
    document.body.appendChild(link);
    link.click();
    link.remove();
    URL.revokeObjectURL(url);
  } catch (err) {
    console.error('Could not export local backup:', err);
  }
}

export default class ErrorBoundary extends Component {
  constructor(props) {
    super(props);
    this.state = { hasError: false, errorMessage: '' };
    this.handleReload = this.handleReload.bind(this);
  }

  static getDerivedStateFromError(error) {
    return {
      hasError: true,
      errorMessage: error?.message || 'Unexpected rendering error.',
    };
  }

  componentDidCatch(error, errorInfo) {
    console.error('Grade Tracker caught an unexpected render error:', error, errorInfo);
  }

  handleReload() {
    if (typeof this.props.onReset === 'function') {
      this.setState({ hasError: false, errorMessage: '' });
      this.props.onReset();
      return;
    }
    window.location.reload();
  }

  render() {
    if (!this.state.hasError) {
      return this.props.children;
    }

    return (
      <div className="error-boundary-shell" role="alert">
        <div className="error-boundary-card">
          <h1>Something went wrong</h1>
          <p>
            Grade Tracker hit an unexpected display error, so the view paused safely.
            Your saved grades remain in local browser storage.
          </p>
          {this.state.errorMessage && (
            <pre className="error-boundary-detail">{this.state.errorMessage}</pre>
          )}
          <div className="error-boundary-actions">
            <button
              type="button"
              className="btn btn-primary"
              onClick={this.handleReload}
            >
              Reload Tracker
            </button>
            <button
              type="button"
              className="btn"
              onClick={downloadRawLocalStorageBackup}
            >
              Download Local Backup (.json)
            </button>
          </div>
        </div>
      </div>
    );
  }
}
