import {Component, signal, WritableSignal} from '@angular/core';
import {CommonModule} from '@angular/common';

@Component({
  selector: 'app-root',
  templateUrl: './app.html',
  styleUrl: './app.scss',
  imports: [CommonModule],
})
export class App {

  jsonData: WritableSignal<any> = signal(null);
  errorMessage = '';

  onFileSelected(event: Event): void {
    const input = event.target as HTMLInputElement;

    if (!input.files || input.files.length === 0) {
      return;
    }

    const file = input.files[0];

    this.loadAccountData(file);
  }

  private loadAccountData(file: File) {
    const reader = new FileReader();

    reader.onload = () => {
      try {
        const text = reader.result as string;
        this.jsonData.set(JSON.parse(text));
        this.errorMessage = '';
      } catch (error) {
        this.errorMessage = 'Invalid JSON format.';
        this.jsonData.set(null);
      }
    };

    reader.readAsText(file);
  }

  getFileFromSolidPod() {
    // @ts-ignore
    chrome.runtime.sendMessage('fdeoabjeeiedpmeboicidbedplbdkpbn',
      {
        type:            'DATA_REQUEST',
        description:     'Kontoauszüge des Jahres 2025 für Zwick, David',
        category:        'finance',
        requestId:       'test-001',
        requesterWebId:  'http://localhost:3000/taxme/profile/card#me',
        accessMode:      'Read'
      },
      (response: any) => console.log(response)
    );
  }

  get accounts(): [any] {
    // @ts-ignore
    return this.jsonData()?.accounts
  }


}
