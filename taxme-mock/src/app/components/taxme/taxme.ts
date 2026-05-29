import { Component, signal, WritableSignal, OnInit } from '@angular/core';
import { CommonModule } from '@angular/common';
import { environment } from '../../../../environment';
import { getDefaultSession } from '@inrupt/solid-client-authn-browser';
import { getSolidDataset, getContainedResourceUrlAll, getFile } from '@inrupt/solid-client';
import { SolidPodExtensionService } from '../../services/solid-pod-extension.service';
import { firstValueFrom } from 'rxjs';

type RequestStatus = 'idle' | 'pending' | 'loading' | 'loaded' | 'denied' | 'error';

@Component({
  selector: 'app-taxme',
  imports: [CommonModule],
  templateUrl: './taxme.html',
  styleUrl: './taxme.scss',
})
export class Taxme implements OnInit {
  jsonData: WritableSignal<any[]> = signal([]);
  isLoggedIn = signal(false);
  webId = signal('');
  requestStatus: WritableSignal<RequestStatus> = signal('idle');
  errorMessage = '';

  constructor(private solidPodExtensionService: SolidPodExtensionService) {}

  ngOnInit() {
    const session = getDefaultSession();
    this.syncSessionState(session);
    session.events.on('login', () => this.syncSessionState(session));
    session.events.on('logout', () => this.syncSessionState(session));
    session.events.on('sessionRestore', () => this.syncSessionState(session));
  }

  private syncSessionState(session: ReturnType<typeof getDefaultSession>) {
    this.isLoggedIn.set(session.info.isLoggedIn);
    this.webId.set(session.info.webId ?? '');
  }

  login() {
    getDefaultSession().login({
      oidcIssuer: environment.SOLID_OIDC_ISSUER,
      redirectUrl: window.location.href,
      clientName: 'TaxMe',
    });
  }

  logout() {
    getDefaultSession().logout();
    this.isLoggedIn.set(false);
    this.webId.set('');
    this.jsonData.set([]);
    this.requestStatus.set('idle');
  }

  onFileSelected(event: Event): void {
    const input = event.target as HTMLInputElement;
    if (!input.files || input.files.length === 0) return;
    this.readMultipleFiles(Array.from(input.files));
  }

  private readMultipleFiles(files: File[]) {
    this.jsonData.set([]);
    files.forEach(f => this.readSingleFile(f));
  }

  private readSingleFile(file: File) {
    const reader = new FileReader();
    reader.onload = () => {
      try {
        this.jsonData.set([...this.jsonData(), JSON.parse(reader.result as string)]);
        this.errorMessage = '';
      } catch {
        this.errorMessage = 'Ungültiges JSON-Format.';
        this.jsonData.set([]);
      }
    };
    reader.readAsText(file);
  }

  async getFileFromSolidPod() {
    const session = getDefaultSession();
    if (!session.info.isLoggedIn || !session.info.webId) {
      this.errorMessage = 'Bitte zuerst mit dem Solid Pod einloggen.';
      return;
    }

    const requestId = `taxme-${Date.now()}`;
    this.requestStatus.set('pending');
    this.errorMessage = '';
    this.jsonData.set([]);

    try {
      await firstValueFrom(
        this.solidPodExtensionService.requestData(
          'Steuerauszüge (bekb, Postfinance)',
          'bekb',
          requestId,
          session.info.webId,
        ),
      );

      const result = await this.pollForApproval(requestId);

      if (!result) {
        this.requestStatus.set('error');
        this.errorMessage = 'Timeout: Keine Antwort erhalten.';
        return;
      }

      if (result.approved && result.containerUrl) {
        await this.loadFilesFromContainer(result.containerUrl, session.fetch);
      } else {
        this.requestStatus.set('denied');
      }
    } catch (e: any) {
      this.requestStatus.set('error');
      this.errorMessage = e?.message ?? 'Unbekannter Fehler';
    }
  }

  private async pollForApproval(
    requestId: string,
    intervalMs = 1500,
    timeoutMs = 120_000,
  ): Promise<any | null> {
    const deadline = Date.now() + timeoutMs;
    while (Date.now() < deadline) {
      const result = await firstValueFrom(
        this.solidPodExtensionService.getApproval(requestId),
      );
      if (result?.approved !== undefined) return result;
      await new Promise(resolve => setTimeout(resolve, intervalMs));
    }
    return null;
  }

  private async loadFilesFromContainer(containerUrl: string, fetchFn: typeof fetch) {
    this.requestStatus.set('loading');
    const dataset = await getSolidDataset(containerUrl, { fetch: fetchFn });
    const urls = getContainedResourceUrlAll(dataset).filter(u => u.endsWith('.json'));

    const files = await Promise.all(
      urls.map(async url => {
        const file = await getFile(url, { fetch: fetchFn });
        return JSON.parse(await file.text());
      }),
    );

    this.jsonData.set(files);
    this.requestStatus.set('loaded');
  }

  accounts(file: any): any[] {
    return file?.accounts ?? [];
  }
}
