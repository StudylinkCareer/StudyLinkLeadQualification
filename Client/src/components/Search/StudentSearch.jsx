import { useState, useEffect, useRef } from 'react';
import { FiSearch, FiUser } from 'react-icons/fi';
import { studentAPI } from '../../services/api';
import './StudentSearch.css';

export default function StudentSearch({ onSelect }) {
  const [query, setQuery] = useState('');
  const [results, setResults] = useState([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [initialLoaded, setInitialLoaded] = useState(false);
  const debounceRef = useRef(null);

  // Load all students on mount
  useEffect(() => {
    loadStudents('');
  }, []);

  const loadStudents = async (q) => {
    setLoading(true);
    setError('');
    try {
      const res = await studentAPI.search(q);
      setResults(res.data || []);
      setInitialLoaded(true);
    } catch (err) {
      setError(err.message || 'Search failed');
    } finally {
      setLoading(false);
    }
  };

  const handleQueryChange = (e) => {
    const val = e.target.value;
    setQuery(val);

    // Debounce search
    if (debounceRef.current) clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(() => {
      loadStudents(val);
    }, 400);
  };

  return (
    <div className="student-search">
      <div className="student-search-header">
        <h2>Student Lookup</h2>
        <p className="student-search-hint">
          Search by name, email, or phone. Use * as wildcard.
        </p>
      </div>

      <div className="student-search-bar">
        <FiSearch className="student-search-icon" />
        <input
          type="text"
          className="student-search-input"
          value={query}
          onChange={handleQueryChange}
          placeholder="e.g. John* or *@gmail.com or +84*"
          autoFocus
        />
      </div>

      {error && <div className="student-search-error">{error}</div>}

      {loading && !initialLoaded && (
        <div className="student-search-loading">Loading students...</div>
      )}

      {initialLoaded && (
        <div className="student-search-results">
          {results.length === 0 ? (
            <div className="student-search-empty">No students found</div>
          ) : (
            <>
              <div className="student-search-count">
                {results.length} student{results.length !== 1 ? 's' : ''} found
              </div>
              <div className="student-search-list">
                {results.map((s) => (
                  <button
                    key={s.uniqueId}
                    className="student-search-item"
                    onClick={() => onSelect(s.uniqueId)}
                  >
                    <div className="student-search-item-icon">
                      <FiUser />
                    </div>
                    <div className="student-search-item-info">
                      <div className="student-search-item-name">
                        {s.fullName || '(No name)'}
                      </div>
                      <div className="student-search-item-details">
                        <span>{s.uniqueId}</span>
                        {s.email && <span>{s.email}</span>}
                        {s.phone && <span>{s.phone}</span>}
                      </div>
                    </div>
                  </button>
                ))}
              </div>
            </>
          )}
        </div>
      )}
    </div>
  );
}
