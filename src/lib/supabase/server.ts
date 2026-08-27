import { createServerClient } from '@supabase/ssr'
import { cookies } from 'next/headers'

/**
 * Creates a Supabase client for use in Server Components, Server Actions, and Route Handlers.
 *
 * This client uses Next.js cookies for session management and respects Row Level Security (RLS).
 * It uses the public anonymous key, with access controlled by RLS policies.
 *
 * IMPORTANT: This creates a new client instance per request to access request-specific cookies.
 * Do not cache or reuse this client across requests.
 *
 * Usage:
 * ```tsx
 * // Server Component
 * import { createClient } from '@/lib/supabase/server'
 *
 * export default async function MyPage() {
 *   const supabase = await createClient()
 *   const { data } = await supabase.from('rooms').select()
 *   return <div>...</div>
 * }
 *
 * // Route Handler
 * import { createClient } from '@/lib/supabase/server'
 *
 * export async function GET() {
 *   const supabase = await createClient()
 *   const { data } = await supabase.from('rooms').select()
 *   return Response.json(data)
 * }
 * ```
 */
export async function createClient() {
  const cookieStore = await cookies()

  return createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        getAll() {
          return cookieStore.getAll()
        },
        setAll(cookiesToSet) {
          try {
            cookiesToSet.forEach(({ name, value, options }) =>
              cookieStore.set(name, value, options)
            )
          } catch {
            // Server Component cannot set cookies
            // This is expected and safe to ignore
          }
        },
      },
    }
  )
}
