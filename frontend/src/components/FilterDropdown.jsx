import React, { useState, useEffect, useRef } from 'react'
import './FilterDropdown.css'

export default function FilterDropdown({ label, children, active = false }) {
  const [isOpen, setIsOpen] = useState(false)
  const dropdownRef = useRef(null)

  useEffect(() => {
    const handleClickOutside = (event) => {
      if (dropdownRef.current && !dropdownRef.current.contains(event.target)) {
        setIsOpen(false)
      }
    }
    document.addEventListener('mousedown', handleClickOutside)
    return () => document.removeEventListener('mousedown', handleClickOutside)
  }, [])

  return (
    <div className="filter-dropdown" ref={dropdownRef}>
      <button 
        className={`filter-dropdown__trigger ${isOpen ? 'filter-dropdown__trigger--open' : ''} ${active ? 'filter-dropdown__trigger--active' : ''}`}
        onClick={() => setIsOpen(!isOpen)}
        type="button"
      >
        <span>{label}</span>
        <svg className={`filter-dropdown__arrow ${isOpen ? 'open' : ''}`} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
          <polyline points="6 9 12 15 18 9"></polyline>
        </svg>
      </button>
      {isOpen && (
        <div className="filter-dropdown__menu" onClick={(e) => e.stopPropagation()}>
          {children}
        </div>
      )}
    </div>
  )
}
