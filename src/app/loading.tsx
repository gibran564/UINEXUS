import { ProjectGridSkeleton } from '@/components/project/project-grid';

export default function Loading() {
  return (
    <div className="container-page py-10">
      <p role="status" className="sr-only">
        Cargando contenido…
      </p>
      <div className="h-9 w-64 animate-pulse rounded-xs bg-sunken" aria-hidden="true" />
      <div className="mt-9">
        <ProjectGridSkeleton />
      </div>
    </div>
  );
}
