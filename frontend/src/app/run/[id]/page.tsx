import RunClient from './RunClient';

export async function generateStaticParams() {
  return [{ id: '1' }];
}

export default function Page() {
  return <RunClient />;
}
