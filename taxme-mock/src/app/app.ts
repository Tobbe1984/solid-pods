import {Component, OnInit} from '@angular/core';
import {RouterOutlet} from '@angular/router';
import {handleIncomingRedirect} from '@inrupt/solid-client-authn-browser';

@Component({
  selector: 'app-root',
  templateUrl: './app.html',
  styleUrl: './app.scss',
  imports: [
    RouterOutlet
  ],
})
export class App implements OnInit{

  async ngOnInit() {
    await handleIncomingRedirect();
  }
}
