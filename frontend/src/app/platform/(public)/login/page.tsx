import { redirect } from 'next/navigation';

/** Platform operators use the same sign-in form as everyone else. */
export default function PlatformLoginPage() {
  redirect('/login');
}
