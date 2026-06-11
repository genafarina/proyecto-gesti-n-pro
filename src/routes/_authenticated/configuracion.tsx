import { createFileRoute } from "@tanstack/react-router";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";

export const Route = createFileRoute("/_authenticated/configuracion")({ component: ConfigPage });

function ConfigPage() {
  return (
    <div className="space-y-4">
      <Card>
        <CardHeader><CardTitle className="text-base">Configuración</CardTitle></CardHeader>
        <CardContent className="text-sm text-muted-foreground space-y-2">
          <p>Esta sección está reservada para configuración avanzada (roles, permisos, parámetros del sistema).</p>
          <p>En esta primera versión los roles de usuario (Administrador, Supervisor, Visualizador) están preparados en la base de datos pero todavía no se aplican restricciones avanzadas.</p>
        </CardContent>
      </Card>
    </div>
  );
}
