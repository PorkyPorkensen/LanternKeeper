import React, { useEffect, useState, type FormEvent } from 'react'
import {
  createUserWithEmailAndPassword,
  onAuthStateChanged,
  signInWithEmailAndPassword,
  signInWithPopup,
  signOut,
} from 'firebase/auth'
import {
  collection,
  deleteDoc,
  doc,
  onSnapshot,
  setDoc,
  updateDoc,
  type DocumentData,
  type QueryDocumentSnapshot,
} from 'firebase/firestore'
import { auth, db, googleProvider } from './firebase'
import './App.css'

type ChatRole = 'user' | 'assistant'

type ChatMessage = {
  id: number
  role: ChatRole
  text: string
}

type ChatHistoryItem = {
  role: ChatRole
  content: string
}

const summaryFields = [
  'Name',
  'Class',
  'Race',
  'Physical Characteristics',
  'Equipment',
  'Background',
] as const

type SummaryLabel = (typeof summaryFields)[number]

type SummaryRow = {
  label: SummaryLabel
  value: string
}

type CharacterAttributes = Record<SummaryLabel, string>

type SavedCharacter = {
  id: string
  name: string
  attributes: CharacterAttributes
  createdAt: number
}

type AppPage = 'home' | 'how-to-use'

const SAVED_CHARACTERS_KEY = 'lantern-keeper-characters'
const SUMMARY_MARKER = '[CHARACTER_SUMMARY]'

const escapeRegExp = (value: string) => value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')

const stripSummaryBoilerplate = (value: string) =>
  value
    .replace(/your character summary is complete\.?/gi, '')
    .replace(/here(?:'|’)s (?:the )?(?:summary|character summary)[^.]*\.?/gi, '')
    .replace(/\s{2,}/g, ' ')
    .trim()

const parseSummarySheet = (text: string) => {
  const cleaned = text.replace(/\*/g, '').replace(/\r/g, ' ').trim()
  const markerIndex = cleaned.indexOf(SUMMARY_MARKER)

  if (markerIndex < 0) {
    return null
  }

  const payload = cleaned.slice(markerIndex + SUMMARY_MARKER.length).trim()
  const allKnownLabels = [
    ...summaryFields,
    'Recommended Class',
    'Party Role',
    'Playstyle',
    'Personality',
    'Goal',
    'Background in Brief',
  ]
  const nextLabelPattern = allKnownLabels.map(escapeRegExp).join('|')

  return summaryFields.map((field) => ({
    label: field,
    value: (() => {
      const expression = new RegExp(
        `${escapeRegExp(field)}\\s*:\\s*([\\s\\S]*?)(?=(?:${nextLabelPattern})\\s*:|$)`,
        'i',
      )
      const match = payload.match(expression)
      const extracted = match?.[1]?.trim()
      const normalized = stripSummaryBoilerplate(
        extracted?.replace(/\*/g, '').replace(/\s{2,}/g, ' ').trim() ?? '',
      )
      return normalized && normalized.length > 0 ? normalized : 'Not Selected'
    })(),
  }))
}

const rowsToAttributes = (rows: SummaryRow[]): CharacterAttributes => {
  return {
    Name: rows.find((row) => row.label === 'Name')?.value || 'Not Selected',
    Class: rows.find((row) => row.label === 'Class')?.value || 'Not Selected',
    Race: rows.find((row) => row.label === 'Race')?.value || 'Not Selected',
    'Physical Characteristics':
      rows.find((row) => row.label === 'Physical Characteristics')?.value ||
      'Not Selected',
    Equipment: rows.find((row) => row.label === 'Equipment')?.value || 'Not Selected',
    Background: rows.find((row) => row.label === 'Background')?.value || 'Not Selected',
  }
}

type AuthMode = 'signin' | 'signup'

function AuthModal({
  onClose,
  onGoogleSignIn,
  onEmailSubmit,
}: {
  onClose: () => void
  onGoogleSignIn: () => Promise<void>
  onEmailSubmit: (email: string, password: string, mode: AuthMode) => Promise<string | null>
}) {
  const [mode, setMode] = useState<AuthMode>('signin')
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [isSubmitting, setIsSubmitting] = useState(false)

  const handleBackdropClick = (event: React.MouseEvent<HTMLDivElement>) => {
    if (event.target === event.currentTarget) {
      onClose()
    }
  }

  const handleSubmit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    setError(null)
    setIsSubmitting(true)
    const result = await onEmailSubmit(email.trim(), password, mode)
    setIsSubmitting(false)
    if (result) {
      setError(result)
    } else {
      onClose()
    }
  }

  const handleGoogle = async () => {
    setError(null)
    setIsSubmitting(true)
    await onGoogleSignIn()
    setIsSubmitting(false)
    onClose()
  }

  return (
    <div className="modal-backdrop" onClick={handleBackdropClick} role="dialog" aria-modal="true">
      <div className="auth-modal">
        <button className="modal-close" onClick={onClose} aria-label="Close">
          &times;
        </button>

        <h2 className="modal-title">
          {mode === 'signin' ? 'Welcome Back' : 'Create Account'}
        </h2>

        <button
          type="button"
          className="google-button"
          onClick={handleGoogle}
          disabled={isSubmitting}
        >
          <svg viewBox="0 0 48 48" width="20" height="20" aria-hidden="true">
            <path fill="#4285F4" d="M46.5 24.5c0-1.6-.1-3.1-.4-4.5H24v8.5h12.7c-.6 3-2.3 5.5-4.8 7.2v6h7.7c4.5-4.1 7-10.2 7-17.2z"/>
            <path fill="#34A853" d="M24 48c6.5 0 11.9-2.1 15.9-5.8l-7.7-6c-2.2 1.5-5 2.3-8.2 2.3-6.3 0-11.6-4.2-13.5-9.9H2.5v6.2C6.5 42.8 14.7 48 24 48z"/>
            <path fill="#FBBC05" d="M10.5 28.6c-.5-1.5-.8-3-.8-4.6s.3-3.1.8-4.6v-6.2H2.5C.9 16.6 0 20.2 0 24s.9 7.4 2.5 10.8l8-6.2z"/>
            <path fill="#EA4335" d="M24 9.5c3.5 0 6.6 1.2 9.1 3.6l6.8-6.8C35.9 2.4 30.4 0 24 0 14.7 0 6.5 5.2 2.5 13.2l8 6.2C12.4 13.7 17.7 9.5 24 9.5z"/>
          </svg>
          Continue with Google
        </button>

        <div className="modal-divider"><span>or</span></div>

        <form onSubmit={handleSubmit} className="auth-form">
          <label htmlFor="auth-email" className="auth-label">Email</label>
          <input
            id="auth-email"
            type="email"
            className="auth-input"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            placeholder="you@example.com"
            required
            disabled={isSubmitting}
          />

          <label htmlFor="auth-password" className="auth-label">Password</label>
          <input
            id="auth-password"
            type="password"
            className="auth-input"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            placeholder={mode === 'signup' ? 'At least 6 characters' : 'Your password'}
            required
            disabled={isSubmitting}
          />

          {error ? <p className="auth-error">{error}</p> : null}

          <button type="submit" className="auth-submit" disabled={isSubmitting}>
            {isSubmitting ? 'Please wait...' : mode === 'signin' ? 'Sign In' : 'Create Account'}
          </button>
        </form>

        <p className="modal-switch">
          {mode === 'signin' ? (
            <>
              No account?{' '}
              <button type="button" className="modal-switch-btn" onClick={() => { setMode('signup'); setError(null) }}>
                Sign up
              </button>
            </>
          ) : (
            <>
              Already have an account?{' '}
              <button type="button" className="modal-switch-btn" onClick={() => { setMode('signin'); setError(null) }}>
                Sign in
              </button>
            </>
          )}
        </p>
      </div>
    </div>
  )
}

function App() {
  const [page, setPage] = useState<AppPage>(() =>
    window.location.hash === '#how-to-use' ? 'how-to-use' : 'home',
  )
  const [messages, setMessages] = useState<ChatMessage[]>([
    {
      id: 1,
      role: 'assistant',
      text: 'I am the Lantern Keeper. Tell me what kind of hero calls to you, and I will help you shape them.',
    },
  ])
  const [input, setInput] = useState('')
  const [isLoading, setIsLoading] = useState(false)
  const [savedCharacters, setSavedCharacters] = useState<SavedCharacter[]>([])
  const [selectedCharacterId, setSelectedCharacterId] = useState<string | null>(null)
  const [isAuthenticated, setIsAuthenticated] = useState(false)
  const [userEmail, setUserEmail] = useState<string | null>(null)
  const [userId, setUserId] = useState<string | null>(null)
  const [showAuthModal, setShowAuthModal] = useState(false)
  const [pendingSaveRows, setPendingSaveRows] = useState<SummaryRow[] | null>(null)
  const [isChatMinimized, setIsChatMinimized] = useState(false)
  const [editingField, setEditingField] = useState<SummaryLabel | null>(null)
  const [editingValue, setEditingValue] = useState('')

  useEffect(() => {
    const syncPageFromHash = () => {
      setPage(window.location.hash === '#how-to-use' ? 'how-to-use' : 'home')
    }

    syncPageFromHash()
    window.addEventListener('hashchange', syncPageFromHash)

    return () => window.removeEventListener('hashchange', syncPageFromHash)
  }, [])

  const navigateToPage = (nextPage: AppPage) => {
    const nextHash = nextPage === 'how-to-use' ? '#how-to-use' : ''

    if (window.location.hash !== nextHash) {
      window.location.hash = nextHash
    }

    setPage(nextPage)
  }

  useEffect(() => {
    const unsubscribe = onAuthStateChanged(auth, (user) => {
      setIsAuthenticated(!!user)
      setUserEmail(user?.email ?? null)
      setUserId(user?.uid ?? null)
    })

    return unsubscribe
  }, [])

  useEffect(() => {
    if (!userId || !pendingSaveRows) {
      return
    }

    const saveQueuedCharacter = async () => {
      const rows = pendingSaveRows
      const attributes = rowsToAttributes(rows)
      const generatedName =
        attributes.Name !== 'Not Selected' && attributes.Name.trim().length > 0
          ? attributes.Name.trim()
          : 'Unnamed Hero'

      const newCharacter: SavedCharacter = {
        id: `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
        name: generatedName,
        attributes,
        createdAt: Date.now(),
      }

      try {
        await setDoc(doc(db, 'users', userId, 'characters', newCharacter.id), {
          name: newCharacter.name,
          attributes: newCharacter.attributes,
          createdAt: newCharacter.createdAt,
        })
        setPendingSaveRows(null)
      } catch (error) {
        const message = error instanceof Error ? error.message : 'Unexpected save error'
        alert(`Character save failed: ${message}`)
      }
    }

    void saveQueuedCharacter()
  }, [pendingSaveRows, userId])

  useEffect(() => {
    const normalizeCharacter = (character: Partial<SavedCharacter>): SavedCharacter => ({
      id: character.id || `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
      name: character.name || 'Unnamed Hero',
      createdAt: typeof character.createdAt === 'number' ? character.createdAt : Date.now(),
      attributes: {
        Name: character.attributes?.Name || 'Not Selected',
        Class: character.attributes?.Class || 'Not Selected',
        Race: character.attributes?.Race || 'Not Selected',
        'Physical Characteristics':
          character.attributes?.['Physical Characteristics'] || 'Not Selected',
        Equipment: character.attributes?.Equipment || 'Not Selected',
        Background: character.attributes?.Background || 'Not Selected',
      },
    })

    if (!userId) {
      try {
        const raw = localStorage.getItem(SAVED_CHARACTERS_KEY)
        if (!raw) {
          setSavedCharacters([])
          setSelectedCharacterId(null)
          return
        }

        const parsed = JSON.parse(raw) as Partial<SavedCharacter>[]
        if (!Array.isArray(parsed)) {
          setSavedCharacters([])
          setSelectedCharacterId(null)
          return
        }

        const normalized = parsed.map(normalizeCharacter)
        setSavedCharacters(normalized)
        if (normalized.length > 0) {
          setSelectedCharacterId((current) =>
            current && normalized.some((character) => character.id === current)
              ? current
              : normalized[0].id,
          )
        } else {
          setSelectedCharacterId(null)
        }
      } catch {
        setSavedCharacters([])
        setSelectedCharacterId(null)
      }

      return
    }

    const charactersRef = collection(db, 'users', userId, 'characters')
    const unsubscribe = onSnapshot(
      charactersRef,
      (snapshot) => {
        const fromFirestore = snapshot.docs
          .map((docSnap: QueryDocumentSnapshot<DocumentData>) => {
            const data = docSnap.data()
            return normalizeCharacter({
              id: docSnap.id,
              name: typeof data.name === 'string' ? data.name : 'Unnamed Hero',
              createdAt: typeof data.createdAt === 'number' ? data.createdAt : undefined,
              attributes:
                typeof data.attributes === 'object' && data.attributes
                  ? (data.attributes as CharacterAttributes)
                  : undefined,
            })
          })
          .sort((a, b) => b.createdAt - a.createdAt)

        setSavedCharacters(fromFirestore)
        if (fromFirestore.length > 0) {
          setSelectedCharacterId((current) =>
            current && fromFirestore.some((character) => character.id === current)
              ? current
              : fromFirestore[0].id,
          )
        } else {
          setSelectedCharacterId(null)
        }
      },
      () => {
        setSavedCharacters([])
        setSelectedCharacterId(null)
      },
    )

    return unsubscribe
  }, [userId])

  useEffect(() => {
    if (userId) {
      return
    }

    localStorage.setItem(SAVED_CHARACTERS_KEY, JSON.stringify(savedCharacters))
  }, [savedCharacters, userId])

  const saveCharacter = async (rows: SummaryRow[]) => {
    if (!userId) {
      setPendingSaveRows(rows)
      setShowAuthModal(true)
      return
    }

    const attributes = rowsToAttributes(rows)
    const generatedName =
      attributes.Name !== 'Not Selected' && attributes.Name.trim().length > 0
        ? attributes.Name.trim()
        : 'Unnamed Hero'

    const newCharacter: SavedCharacter = {
      id: `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
      name: generatedName,
      attributes,
      createdAt: Date.now(),
    }

    try {
      await setDoc(doc(db, 'users', userId, 'characters', newCharacter.id), {
        name: newCharacter.name,
        attributes: newCharacter.attributes,
        createdAt: newCharacter.createdAt,
      })
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Unexpected save error'
      alert(`Character save failed: ${message}`)
    }
  }

  const handleDeleteCharacter = async (id: string) => {
    if (userId) {
      try {
        await deleteDoc(doc(db, 'users', userId, 'characters', id))
      } catch (error) {
        const message = error instanceof Error ? error.message : 'Unexpected error'
        alert(`Delete failed: ${message}`)
      }
    } else {
      setSavedCharacters((prev) => prev.filter((c) => c.id !== id))
      if (selectedCharacterId === id) setSelectedCharacterId(null)
    }
  }

  const handleEditAttribute = async (field: SummaryLabel, value: string) => {
    if (!selectedCharacter) return
    const updatedAttributes = { ...selectedCharacter.attributes, [field]: value.trim() || 'Not Selected' }
    const updatedName =
      field === 'Name' && value.trim() ? value.trim() : selectedCharacter.name

    if (userId) {
      try {
        await updateDoc(doc(db, 'users', userId, 'characters', selectedCharacter.id), {
          attributes: updatedAttributes,
          name: updatedName,
        })
      } catch (error) {
        const message = error instanceof Error ? error.message : 'Unexpected error'
        alert(`Update failed: ${message}`)
      }
    } else {
      setSavedCharacters((prev) =>
        prev.map((c) =>
          c.id === selectedCharacter.id
            ? { ...c, attributes: updatedAttributes, name: updatedName }
            : c,
        ),
      )
    }
    setEditingField(null)
    setEditingValue('')
  }

  const selectedCharacter = savedCharacters.find(
    (character) => character.id === selectedCharacterId,
  )

  const startNewCharacterChat = () => {
    setMessages([
      {
        id: Date.now(),
        role: 'assistant',
        text: 'A fresh page awaits. Tell me the kind of hero you want to create.',
      },
    ])
    setInput('')
    setIsLoading(false)
  }

  const handleGoogleSignIn = async () => {
    await signInWithPopup(auth, googleProvider)
  }

  const handleEmailSubmit = async (
    email: string,
    password: string,
    mode: 'signin' | 'signup',
  ): Promise<string | null> => {
    try {
      if (mode === 'signin') {
        await signInWithEmailAndPassword(auth, email, password)
      } else {
        await createUserWithEmailAndPassword(auth, email, password)
      }
      return null
    } catch (error) {
      if (error instanceof Error) {
        const msg = error.message
        if (msg.includes('invalid-credential') || msg.includes('wrong-password') || msg.includes('user-not-found')) {
          return 'Incorrect email or password.'
        }
        if (msg.includes('email-already-in-use')) {
          return 'An account with this email already exists.'
        }
        if (msg.includes('weak-password')) {
          return 'Password must be at least 6 characters.'
        }
        if (msg.includes('invalid-email')) {
          return 'Please enter a valid email address.'
        }
        return msg
      }
      return 'Something went wrong. Please try again.'
    }
  }

  const handleSignOut = async () => {
    try {
      await signOut(auth)
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Unexpected sign-out error'
      alert(`Sign-out failed: ${message}`)
    }
  }

  const sendChatMessage = async (text: string) => {
    const userMessage: ChatMessage = { id: Date.now(), role: 'user', text }
    const history: ChatHistoryItem[] = messages.map((message) => ({
      role: message.role,
      content: message.text,
    }))

    setMessages((prev) => [...prev, userMessage])
    setIsLoading(true)

    try {
      const apiBase = import.meta.env.VITE_API_URL ?? ''
      const response = await fetch(`${apiBase}/api/chat`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ message: text, history }),
      })

      const data = (await response.json()) as { text?: string; error?: string }

      if (!response.ok) {
        throw new Error(data.error ?? 'The backend returned an error.')
      }

      setMessages((prev) => [
        ...prev,
        { id: Date.now() + 1, role: 'assistant', text: data.text ?? 'No response received.' },
      ])
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Unexpected error'
      setMessages((prev) => [
        ...prev,
        { id: Date.now() + 1, role: 'assistant', text: `Request failed: ${message}` },
      ])
    } finally {
      setIsLoading(false)
    }
  }

  const sendMessage = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    const trimmed = input.trim()
    if (!trimmed || isLoading) return
    setInput('')
    await sendChatMessage(trimmed)
  }

  const handleRequestSummary = () => {
    if (isLoading) return
    sendChatMessage(
      `Please provide a concise summary of everything we have decided so far using ONLY this exact labeled format. Do not add commentary before or after it:
${SUMMARY_MARKER}
Name:
Class:
Race:
Physical Characteristics:
Equipment:
Background:`,
    )
  }

  return page === 'how-to-use' ? (
    <>
      <header className="site-header">
        <div className="site-header-content">
          <div className="header-top">
            <h1>The Lantern Keeper</h1>
          </div>
          <p className="site-eyebrow">Your DnD guide for new character creation.</p>
          <div className="auth-container">
            <button className="auth-button sign-in" onClick={() => navigateToPage('home')}>
              Back to Chat
            </button>
          </div>
        </div>
      </header>

      <main className="info-page">
        <section className="info-hero">
          <p className="info-kicker">How to Use</p>
          <h2>Shape a character one answer at a time.</h2>
          <p>
            Start in the chat, answer the Lantern Keeper&apos;s questions, and refine your hero until the summary feels
            right. Save finished characters, edit details later, and use this space for a future contact section when
            you want to expand the site.
          </p>
        </section>

        <section className="info-grid" aria-label="How to use the Lantern Keeper">
          <article className="info-card">
            <span className="info-step">01</span>
            <h3>Begin the conversation</h3>
            <p>Open the chat and describe the kind of hero you want. The Keeper will guide the next step.</p>
          </article>

          <article className="info-card">
            <span className="info-step">02</span>
            <h3>Answer the prompts</h3>
            <p>Reply with the details you like, and the Keeper will narrow down class, race, gear, and background.</p>
          </article>

          <article className="info-card">
            <span className="info-step">03</span>
            <h3>Save the result</h3>
            <p>When the summary looks right, save it to your character vault so you can revisit or edit it later.</p>
          </article>

          <article className="info-card info-card-wide">
            <span className="info-step">04</span>
            <h3>Expand this page later</h3>
            <p>
              This page can grow into a home for instructions, contact details, or anything else you want alongside the
              character creator.
            </p>
          </article>
        </section>
      </main>
    </>
  ) : (
    <>
      <header className="site-header">
        <div className="site-header-content">
          <div className="header-top">
            <h1>The Lantern Keeper</h1>
          </div>
          <p className="site-eyebrow">Your DnD guide for new character creation.</p>
          <div className="auth-container">
            {isAuthenticated ? (
              <>
                <span className="user-email">{userEmail}</span>
                <button className="auth-button sign-out" onClick={handleSignOut}>
                  Sign Out
                </button>
              </>
            ) : (
              <button className="auth-button sign-in" onClick={() => setShowAuthModal(true)}>
                Sign In / Up
              </button>
            )}
            <button type="button" className="header-link-button" onClick={() => navigateToPage('how-to-use')}>
              How to Use
            </button>
          </div>
        </div>
      </header>

      <section className="intro-section">
        <div className="intro-speech">
          <img
            src="/avi1.png"
            alt="Lantern Keeper avatar"
            className="keeper-avatar keeper-avatar-intro"
          />
          <p>
            Welcome, wanderer. I am the Lantern Keeper, a mystical guide dwelling in the spaces between worlds.
            Those who seek to forge their destiny in the realms of tabletop adventure often find themselves uncertain of
            their calling, their strengths, their very essence as a hero. That is where I come in. Together, we shall
            kindle the spark of a character worthy of epic tales, a hero born from the convergence of your imagination
            and my guidance.
          </p>
        </div>
      </section>

      <div className="app-container">
        <main className={`chat-app${isChatMinimized ? ' is-minimized' : ''}`}>
          <div className="chat-section-header">
            <span className="chat-section-title">Character Chat</span>
            <button
              type="button"
              className="minimize-chat-button"
              onClick={() => setIsChatMinimized((p) => !p)}
              aria-expanded={!isChatMinimized}
            >
              {isChatMinimized ? 'Expand ▼' : 'Minimise ▲'}
            </button>
          </div>

          {!isChatMinimized && (
          <>
        <section className="messages" aria-live="polite">
        {messages.map((message) => (
          (() => {
            const summaryRows =
              message.role === 'assistant' ? parseSummarySheet(message.text) : null

            return (
              <article
                key={message.id}
                className={`message message-${message.role}`}
                aria-label={`${message.role} message`}
              >
                {message.role === 'assistant' ? (
                  <div className="assistant-message-layout">
                    <img
                      src="/avi1.png"
                      alt=""
                      aria-hidden="true"
                      className="keeper-avatar keeper-avatar-chat"
                    />
                    <div className="assistant-message-content">
                      <p className="message-role">Lantern Keeper</p>
                      {summaryRows ? (
                        <>
                          <div className="summary-sheet" role="table" aria-label="character summary">
                            {summaryRows.map((row) => (
                              <div className="summary-row" role="row" key={row.label}>
                                <span className="summary-label" role="rowheader">
                                  {row.label}
                                </span>
                                <span className="summary-value" role="cell">
                                  {row.value}
                                </span>
                              </div>
                            ))}
                          </div>

                          <button
                            type="button"
                            className="save-character-button"
                            onClick={() => saveCharacter(summaryRows)}
                          >
                            Save Character
                          </button>
                        </>
                      ) : (
                        <p>{message.text}</p>
                      )}
                    </div>
                  </div>
                ) : (
                  <>
                    <p className="message-role">You</p>
                    <p>{message.text}</p>
                  </>
                )}
              </article>
            )
          })()
        ))}

        {isLoading ? (
          <article className="message message-assistant" aria-label="assistant typing">
            <div className="assistant-message-layout">
              <img
                src="/avi1.png"
                alt=""
                aria-hidden="true"
                className="keeper-avatar keeper-avatar-chat"
              />
              <div className="assistant-message-content">
                <p className="message-role">Lantern Keeper</p>
                <p>Thinking...</p>
              </div>
            </div>
          </article>
        ) : null}
      </section>

      <form className="composer" onSubmit={sendMessage}>
        <label htmlFor="chat-input" className="visually-hidden">
          Message
        </label>
        <textarea
          id="chat-input"
          name="chat-input"
          rows={3}
          maxLength={1000}
          value={input}
          placeholder="I want a sneaky character who still feels magical..."
          onChange={(event) => setInput(event.target.value)}
          disabled={isLoading}
        />
        <button type="submit" disabled={isLoading || !input.trim()}>
          {isLoading ? 'Sending...' : 'Send'}
        </button>
      </form>

      <section className="chat-actions" aria-label="chat actions">
        {messages.filter((m) => m.role === 'user').length >= 3 ? (
          <button
            type="button"
            className="request-summary-button"
            onClick={handleRequestSummary}
            disabled={isLoading}
          >
            ✦ Request Character Summary
          </button>
        ) : null}
        <button
          type="button"
          className="new-chat-button"
          onClick={startNewCharacterChat}
          disabled={isLoading}
        >
          Start New Character Chat
        </button>
      </section>
      </>
      )}
      </main>

      <aside className="character-vault" aria-label="saved characters">
        <div className="character-vault-header">
          <p className="character-vault-title">Saved Characters</p>
        </div>

        {savedCharacters.length > 0 ? (
          <>
            <div className="character-buttons">
              {savedCharacters.map((character) => (
                <button
                  key={character.id}
                  type="button"
                  className={`character-chip ${
                    selectedCharacterId === character.id ? 'is-active' : ''
                  }`}
                  onClick={() =>
                    setSelectedCharacterId((current) =>
                      current === character.id ? null : character.id,
                    )
                  }
                >
                  {character.name}
                </button>
              ))}
            </div>

            {selectedCharacter ? (
              <>
                <div className="character-sheet" role="table" aria-label="selected character">
                  {summaryFields.map((field) => (
                    <div className="summary-row" role="row" key={field}>
                      <span className="summary-label" role="rowheader">{field}</span>
                      <span className="summary-value" role="cell">
                        {selectedCharacter.attributes[field]}
                      </span>
                    </div>
                  ))}
                </div>

                <div className="character-edit-section">
                  {editingField ? (
                    <div className="edit-field-form">
                      <p className="edit-field-label">
                        Editing: <strong>{editingField}</strong>
                      </p>
                      <input
                        type="text"
                        className="edit-field-input"
                        value={editingValue}
                        onChange={(e) => setEditingValue(e.target.value)}
                        placeholder={`New value for ${editingField}`}
                        autoFocus
                      />
                      <div className="edit-field-actions">
                        <button
                          type="button"
                          className="edit-save-button"
                          onClick={() => handleEditAttribute(editingField, editingValue)}
                        >
                          Save
                        </button>
                        <button
                          type="button"
                          className="edit-cancel-button"
                          onClick={() => { setEditingField(null); setEditingValue('') }}
                        >
                          Cancel
                        </button>
                      </div>
                    </div>
                  ) : (
                    <div className="character-actions">
                      <select
                        className="edit-field-select"
                        value=""
                        onChange={(e) => {
                          const field = e.target.value as SummaryLabel
                          if (field) {
                            setEditingField(field)
                            setEditingValue(selectedCharacter.attributes[field])
                          }
                        }}
                      >
                        <option value="" disabled>Edit an attribute…</option>
                        {summaryFields.map((field) => (
                          <option key={field} value={field}>{field}</option>
                        ))}
                      </select>
                      <button
                        type="button"
                        className="delete-character-button"
                        onClick={() => {
                          if (window.confirm(`Delete "${selectedCharacter.name}"? This cannot be undone.`)) {
                            handleDeleteCharacter(selectedCharacter.id)
                          }
                        }}
                      >
                        Delete Character
                      </button>
                    </div>
                  )}
                </div>
              </>
            ) : null}
          </>
        ) : (
          <p className="empty-state">No saved characters yet. To save a character, first sign in/up, ask for a summary, then click Save Character.</p>
        )}
      </aside>
      </div>

      {showAuthModal ? (
        <AuthModal
          onClose={() => setShowAuthModal(false)}
          onGoogleSignIn={handleGoogleSignIn}
          onEmailSubmit={handleEmailSubmit}
        />
      ) : null}
    </>
  )
}

export default App
