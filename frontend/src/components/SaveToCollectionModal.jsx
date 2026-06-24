import React, { useState, useEffect } from 'react'
import { createPortal } from 'react-dom'
import { watchService } from '../services/watchService'
import { watchlistService } from '../services/watchlistService'
import './SaveToCollectionModal.css'

function SaveToCollectionModal({ movieId, mediaType = "movie", isOpen, onClose }) {
  const [collections, setCollections] = useState([])
  const [checkedState, setCheckedState] = useState({})
  const [loadingIds, setLoadingIds] = useState(new Set())
  const [loading, setLoading] = useState(true)

  // Create view state
  const [isCreateView, setIsCreateView] = useState(false)
  const [newName, setNewName] = useState('')
  const [newDesc, setNewDesc] = useState('')
  const [creating, setCreating] = useState(false)

  useEffect(() => {
    if (isOpen) {
      document.body.style.overflow = 'hidden'
    }
    return () => {
      document.body.style.overflow = ''
    }
  }, [isOpen])

  useEffect(() => {
    if (!isOpen) {
      setIsCreateView(false)
      setNewName('')
      setNewDesc('')
      return
    }

    let isMounted = true
    setLoading(true)

    Promise.all([
      watchlistService.getCollections(),
      watchlistService.getMovieStatus(movieId, mediaType),
    ])
      .then(([collRes, statRes]) => {
        if (!isMounted) return
        setCollections(collRes.collections || [])
        
        const cState = {}
        if (statRes.collections) {
          statRes.collections.forEach(s => {
            cState[s.id] = s.has_movie
          })
        }
        setCheckedState(cState)
      })
      .catch(err => console.error("Error loading watchlist info:", err))
      .finally(() => {
        if (isMounted) setLoading(false)
      })

    return () => { isMounted = false }
  }, [isOpen, movieId])

  const handleToggle = async (collection) => {
    const cid = collection.id
    const isChecked = checkedState[cid]
    const willCheck = !isChecked

    // Optimistic UI
    setCheckedState(prev => ({ ...prev, [cid]: willCheck }))
    setLoadingIds(prev => new Set(prev).add(cid))

    try {
      if (willCheck) {
        await watchlistService.addToCollection(cid, movieId, mediaType)
        // Also add to old flat table for signals
        await watchService.addToWatchlist(movieId, mediaType).catch(() => {}) 
      } else {
        await watchlistService.removeFromCollection(cid, movieId, mediaType)
      }
    } catch (err) {
      console.error("Failed to toggle collection:", err)
      // Revert optimistic
      setCheckedState(prev => ({ ...prev, [cid]: isChecked }))
    } finally {
      setLoadingIds(prev => {
        const next = new Set(prev)
        next.delete(cid)
        return next
      })
    }
  }

  const handleCreate = async (e) => {
    e.preventDefault()
    if (!newName.trim()) return
    setCreating(true)

    try {
      // 1. Create collection
      const newColl = await watchlistService.createCollection(newName.trim(), newDesc.trim() || null)
      
      // 2. Add movie to it
      await watchlistService.addToCollection(newColl.id, movieId, mediaType)
      
      // 3. Add to old flat table
      await watchService.addToWatchlist(movieId, mediaType).catch(() => {})

      // 4. Update local state
      setCollections([newColl, ...collections])
      setCheckedState(prev => ({ ...prev, [newColl.id]: true }))
      
      // Back to list
      setIsCreateView(false)
      setNewName('')
      setNewDesc('')
    } catch (err) {
      console.error("Failed to create and add:", err)
    } finally {
      setCreating(false)
    }
  }

  if (!isOpen) return null

  return createPortal(
    <div className="collection-modal-overlay" onClick={onClose}>
      <div className="collection-modal-content" onClick={e => e.stopPropagation()}>
        
        {/* CREATE VIEW */}
        {isCreateView ? (
          <>
            <div className="collection-modal-header">
              <button className="icon-btn back-btn" onClick={() => setIsCreateView(false)}>
                ←
              </button>
              <h2>Create New Watchlist</h2>
              <button className="icon-btn close-btn" onClick={onClose}>×</button>
            </div>
            
            <form className="collection-create-form" onSubmit={handleCreate}>
              <div className="form-group">
                <label>Name</label>
                <input 
                  type="text" 
                  value={newName} 
                  onChange={e => setNewName(e.target.value)} 
                  maxLength={50}
                  placeholder="e.g. Action Movies"
                  autoFocus
                />
                <div className="char-count">{newName.length}/50</div>
              </div>
              
              <div className="form-group">
                <label>Description (optional)</label>
                <textarea 
                  value={newDesc} 
                  onChange={e => setNewDesc(e.target.value)} 
                  maxLength={150}
                  placeholder="Add a description..."
                  rows={3}
                />
                <div className="char-count">{newDesc.length}/150</div>
              </div>

              <button 
                type="submit" 
                className="create-submit-btn" 
                disabled={!newName.trim() || creating}
              >
                {creating ? 'Creating...' : 'Create Watchlist'}
              </button>
            </form>
          </>

        ) : (
          
          /* LIST VIEW */
          <>
            <div className="collection-modal-header">
              <h2>Save to Watchlist</h2>
              <button className="icon-btn close-btn" onClick={onClose}>×</button>
            </div>

            {loading ? (
              <div className="collection-loading">Loading your watchlists...</div>
            ) : (
              <div className="collection-list">
                {collections.length === 0 ? (
                  <div className="no-collections">You don't have any watchlists yet.</div>
                ) : (
                  collections.map(coll => (
                    <label 
                      key={coll.id} 
                      className={`collection-row ${loadingIds.has(coll.id) ? 'loading' : ''}`}
                    >
                      <input 
                        type="checkbox" 
                        checked={!!checkedState[coll.id]} 
                        onChange={() => handleToggle(coll)}
                        disabled={loadingIds.has(coll.id)}
                      />
                      <div className="collection-info">
                        <span className="collection-name">{coll.name}</span>
                        {/* Note: item_count isn't fully accurate when we optimistic-add, but it's fine for simple display */}
                      </div>
                      {loadingIds.has(coll.id) && <span className="row-spinner">...</span>}
                    </label>
                  ))
                )}
                
                <div className="create-new-row" onClick={() => setIsCreateView(true)}>
                  <div className="plus-icon">+</div>
                  <span>Create New Watchlist</span>
                </div>
              </div>
            )}
          </>
        )}
      </div>
    </div>,
    document.body
  )
}

export default SaveToCollectionModal
