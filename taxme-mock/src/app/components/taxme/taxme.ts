import { Component, signal, WritableSignal } from '@angular/core';
import { CommonModule } from '@angular/common';
import { environment } from '../../../../environment';
import { getDefaultSession } from '@inrupt/solid-client-authn-browser';
import { SolidPodExtensionService } from '../../services/solid-pod-extension.service';
import { getFile } from '@inrupt/solid-client';

@Component({
  selector: 'app-taxme',
  imports: [CommonModule],
  templateUrl: './taxme.html',
  styleUrl: './taxme.scss',
})
export class Taxme {
  jsonData: WritableSignal<any> = signal([]);
  errorMessage = '';

  constructor(private solidPodExtensionService: SolidPodExtensionService) {}

  onFileSelected(event: Event): void {
    const input = event.target as HTMLInputElement;

    if (!input.files || input.files.length === 0) {
      return;
    }

    const files = Array.from(input.files);

    this.readMultipleFiles(files);
  }

  private readMultipleFiles(files: File[]) {
    this.jsonData.set([]);

    files.forEach((file) => {
      this.readSingleFile(file);
    });
  }

  getFileFromSolidPod() {
    const requestId = `taxme-${Date.now()}`;
    this.solidPodExtensionService
      .requestData('Grant access to tax data', 'TAXME', requestId, environment.SOLID_CLIENT_ID || undefined)
      .subscribe((response) => {
        console.log('Access request response:', response);
      });
  }

  private readSingleFile(file: File) {
    const reader = new FileReader();
    reader.onload = () => {
      try {
        const text = reader.result as string;
        this.jsonData.set([...this.jsonData(), JSON.parse(text)]);
        this.errorMessage = '';
      } catch (error) {
        this.errorMessage = 'Invalid JSON format.';
        this.jsonData.set(null);
      }
    };
    reader.readAsText(file);
  }

  loadAccountsFromSolid() {
    this.jsonData.set([]);
    const urls = [
      'http://localhost:3000/bekb/bekb.json',
      'http://localhost:3000/bekb/postfinance.json',
    ];
    urls.forEach((url) => this.loadFileFromSolid(url).then());
  }

  private async loadFileFromSolid(url: string) {
    const session = getDefaultSession();
    if (!session.info.isLoggedIn || !session.info.webId) return;

    const file = await getFile(url, { fetch: session.fetch });

    this.jsonData.set([...this.jsonData(), JSON.parse(await file.text())]);
  }

  login() {
    if (!getDefaultSession().info.isLoggedIn) {
      getDefaultSession().login({
        oidcIssuer: environment.SOLID_OIDC_ISSUER,
        redirectUrl: window.location.href,
        clientName: 'Angular Solid Demo',
      });
    }
  }

  logout() {
    getDefaultSession().logout();
  }

  accounts(file: any): any[] {
    // @ts-ignore
    return file?.accounts;
  }
}
