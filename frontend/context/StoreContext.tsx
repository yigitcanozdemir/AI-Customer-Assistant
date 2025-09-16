import { createContext, useContext, useState, ReactNode } from "react"

export interface Message {
  id: string
  type: "user" | "assistant"
  content: string
  timestamp: Date
  products?: any[]
  order?: any[]
  suggestions?: string[]
}

interface StoreContextType {
  store: string
  setStore: (store: string) => void
  isAssistantOpen: boolean
  setIsAssistantOpen: (open: boolean) => void
  messages: Message[]
  setMessages: (msgs: Message[]) => void
}

const StoreContext = createContext<StoreContextType | undefined>(undefined)

export const StoreProvider = ({ children }: { children: ReactNode }) => {
  const [store, setStore] = useState("Aurora Style")
  const [isAssistantOpen, setIsAssistantOpen] = useState(false)
  const [messages, setMessages] = useState<Message[]>([])

  return (
    <StoreContext.Provider
      value={{ store, setStore, isAssistantOpen, setIsAssistantOpen, messages, setMessages }}
    >
      {children}
    </StoreContext.Provider>
  )
}

export const useStore = () => {
  const context = useContext(StoreContext)
  if (!context) throw new Error("useStore must be used within StoreProvider")
  return context
}
