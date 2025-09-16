"use client"

import type React from "react"
import { createContext, useContext, useState, useEffect } from "react"
import { v4 as uuidv4 } from "uuid"

interface UserContextType {
  userId: string | null
  userName: string | null
  isUserSet: boolean
  setUser: (firstName: string, lastName: string) => void
  clearUser: () => void
}

const UserContext = createContext<UserContextType | undefined>(undefined)

export const useUser = () => {
  const context = useContext(UserContext)
  if (!context) {
    throw new Error("useUser must be used within a UserProvider")
  }
  return context
}

export const UserProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const [userId, setUserId] = useState<string | null>(null)
  const [userName, setUserName] = useState<string | null>(null)
  const [isUserSet, setIsUserSet] = useState(false)

  useEffect(() => {
    if (typeof window !== "undefined") {
      try {
        const savedUserId = sessionStorage.getItem("user_id")
        const savedUserName = sessionStorage.getItem("user_name")

        if (savedUserId && savedUserName) {
          setUserId(savedUserId)
          setUserName(savedUserName)
          setIsUserSet(true)
        }
      } catch (error) {
        console.error("Failed to load user data:", error)
      }
    }
  }, [])

  const setUser = (firstName: string, lastName: string) => {
    const fullName = `${firstName} ${lastName}`.trim()
    const newUserId = uuidv4()

    setUserId(newUserId)
    setUserName(fullName)
    setIsUserSet(true)

    if (typeof window !== "undefined") {
      try {
        sessionStorage.setItem("user_id", newUserId)
        sessionStorage.setItem("user_name", fullName)
      } catch (error) {
        console.error("Failed to save user data:", error)
      }
    }
  }

  const clearUser = () => {
    setUserId(null)
    setUserName(null)
    setIsUserSet(false)

    if (typeof window !== "undefined") {
      try {
        sessionStorage.removeItem("user_id")
        sessionStorage.removeItem("user_name")
      } catch (error) {
        console.error("Failed to clear user data:", error)
      }
    }
  }

  const value: UserContextType = {
    userId,
    userName,
    isUserSet,
    setUser,
    clearUser,
  }

  return <UserContext.Provider value={value}>{children}</UserContext.Provider>
}
