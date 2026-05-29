import { Component, signal, WritableSignal } from '@angular/core';
import { CommonModule } from '@angular/common';
import { environment } from '../../../../environment';
import { getDefaultSession } from '@inrupt/solid-client-authn-browser';
import { overwriteFile } from '@inrupt/solid-client';
import { SolidPodExtensionService } from '../../services/solid-pod-extension.service';
import { firstValueFrom } from 'rxjs';
import bekb from '../../../../mockdata/bekb.json';
import postfinance from '../../../../mockdata/postfinance.json';

type WriteStatus = 'idle' | 'pending' | 'writing' | 'done' | 'denied' | 'error';

@Component({
  selector: 'app-bekb',
  imports: [CommonModule],
  templateUrl: './bekb.html',
  styleUrl: './bekb.scss',
})
export class Bekb {
  writeStatus: WritableSignal<WriteStatus> = signal('idle');
  sessionWebId: WritableSignal<string | null> = signal(null);

  constructor(private solidPodExtensionService: SolidPodExtensionService) {
    const session = getDefaultSession();
    session.events.on('login', () => this.sessionWebId.set(session.info.webId ?? null));
    session.events.on('logout', () => this.sessionWebId.set(null));
    session.events.on('sessionRestore', () => this.sessionWebId.set(session.info.webId ?? null));
    if (session.info.isLoggedIn) this.sessionWebId.set(session.info.webId ?? null);
  }

  login() {
    getDefaultSession().login({
      oidcIssuer: environment.SOLID_OIDC_ISSUER,
      redirectUrl: window.location.href,
      clientName: 'BEKB',
    });
  }

  async grantAccessToSolidPod() {
    const session = getDefaultSession();
    if (!session.info.isLoggedIn) {
      this.login();
      return;
    }
    const requestId = `bekb-${Date.now()}`;
    this.writeStatus.set('pending');
    try {
      await firstValueFrom(
        this.solidPodExtensionService.retrieveData(
          'Kontodaten in Solid Pod ablegen', 'bekb', requestId, session.info.webId,
        ),
      );
      const result = await this.pollForApproval(requestId);
      if (result?.approved && result.containerUrl) {
        this.writeStatus.set('writing');
        await this.writeFiles(result.containerUrl, session.fetch);
        this.writeStatus.set('done');
      } else {
        this.writeStatus.set('denied');
      }
    } catch (e: any) {
      console.error('Write failed:', e);
      this.writeStatus.set('error');
    }
  }

  private async pollForApproval(requestId: string, timeoutMs = 120000): Promise<any> {
    const deadline = Date.now() + timeoutMs;
    while (Date.now() < deadline) {
      const result = await firstValueFrom(this.solidPodExtensionService.getApproval(requestId));
      if (!result?.pending) return result;
      await new Promise<void>(r => setTimeout(r, 1500));
    }
    return null;
  }

  private async writeFiles(containerUrl: string, fetchFn: typeof fetch) {
    await this.writeJson(bekb, `${containerUrl}bekb.json`, fetchFn);
    await this.writeJson(postfinance, `${containerUrl}postfinance.json`, fetchFn);
  }

  async writeJson(input: any, url: string, fetchFn: typeof fetch) {
    const json = { ...input, date: new Date() };
    const blob = new Blob([JSON.stringify(json, null, 2)], { type: 'application/json' });
    await overwriteFile(url, blob, { contentType: 'application/json', fetch: fetchFn });
  }
}
