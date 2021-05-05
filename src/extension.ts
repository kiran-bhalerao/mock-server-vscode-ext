/*---------------------------------------------------------
 * Copyright (C) Microsoft Corporation. All rights reserved.
 *--------------------------------------------------------*/

import * as express from 'express';
import * as killable from 'killable';
import { posix } from 'path';
import * as vscode from 'vscode';
import { MemFS } from './fileSystemProvider';

let myStatusBarItem: vscode.StatusBarItem;

function createApp(
	memFs: MemFS
): [(file_name: string) => Promise<void>, () => Promise<void>] {
	let server: any;

	return [
		async (file_name: string) => {
			if (typeof server?.kill === 'function') {
				await new Promise((r) => server.kill(r));
			}

			const app = express();

			const readBuff = memFs.readFile(vscode.Uri.parse(`memfs:/${file_name}`));
			const readStr = Buffer.from(readBuff).toString('utf8');

			const routes: { route: string; response: any }[] = JSON.parse(readStr);
			routes.forEach(({ route, response }) => {
				memFs.writeFile(
					vscode.Uri.parse(`memfs:/${route}`),
					Buffer.from(JSON.stringify(response)),
					{
						create: true,
						overwrite: true,
					}
				);

				app.get(route, async (_, res) => {
					const read = memFs.readFile(vscode.Uri.parse(`memfs:/${route}`));
					const response = JSON.parse(Buffer.from(read).toString('utf8'));
					res.send({ data: response });
				});
			});

			server = app.listen(9000);
			killable(server);
		},
		async () => {
			if (typeof server?.kill === 'function') {
				await new Promise((r) => server.kill(r));
			}
		},
	];
}

export function activate({ subscriptions }: vscode.ExtensionContext) {
	const myCommandId = 'mockApiServer.start';
	const memFs = new MemFS();
	let last_up_file = '';
	let isRunning = false;

	const [_createApp, killServer] = createApp(memFs);

	subscriptions.push(
		vscode.commands.registerCommand('mockApiServer.stop', async () => {
			await killServer();
			isRunning = false;
			updateStatusBarItem(last_up_file, isRunning);
			vscode.window.showInformationMessage('Mock API Server stopped.');
		})
	);

	subscriptions.push(
		vscode.commands.registerCommand(myCommandId, async () => {
			if (vscode.window.activeTextEditor) {
				const file_extension = getFileExtension(vscode.window.activeTextEditor);
				const file_name = getFileName(vscode.window.activeTextEditor);

				if (file_extension === '.json' && file_name) {
					const fileUri = vscode.window.activeTextEditor.document.uri;

					// eslint-disable-next-line @typescript-eslint/ban-ts-comment
					//@ts-ignore
					const readData = await vscode.workspace.fs.readFile(fileUri);
					const readStr = Buffer.from(readData).toString('utf8');

					try {
						const OBJ = JSON.parse(readStr);
						try {
							// write file
							memFs.writeFile(
								vscode.Uri.parse(`memfs:/${file_name}`),
								Buffer.from(
									JSON.stringify(
										Object.entries(OBJ).map(([k, v]) => ({ route: k, response: v }))
									)
								),
								{
									create: true,
									overwrite: true,
								}
							);

							await _createApp(file_name);
							isRunning = true;
							last_up_file = file_name;
							updateStatusBarItem(last_up_file, isRunning);

							vscode.window.showInformationMessage(
								`Running ${file_name} on http://localhost:9000
								 with active routes ::	${Object.entries(OBJ)
										.map(([k, v]) => k)
										.join(', ')}	
								`
							);
						} catch (err) {
							vscode.window.showInformationMessage(err.message);
						}
					} catch (e) {
						vscode.window.showInformationMessage('Invalid JSON file');
					}
				}
			}
		})
	);

	// create a new status bar item that we can now manage
	myStatusBarItem = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Right, 100);
	myStatusBarItem.command = myCommandId;
	subscriptions.push(myStatusBarItem);

	// register some listener that make sure the status bar
	// item always up-to-date
	subscriptions.push(
		vscode.window.onDidChangeActiveTextEditor(() =>
			updateStatusBarItem(last_up_file, isRunning)
		)
	);
	subscriptions.push(
		vscode.workspace.onDidChangeTextDocument((args) => {
			if (args.document.isDirty) {
				updateStatusBarItem(last_up_file, isRunning, true);
			}
		})
	);

	// update status bar item once at start
	updateStatusBarItem(last_up_file, isRunning);
}

function updateStatusBarItem(
	active_file_name: string,
	isRunning = false,
	isDirty = false
): void {
	if (vscode.window.activeTextEditor) {
		const file_extension = getFileExtension(vscode.window.activeTextEditor);
		const file_name = getFileName(vscode.window.activeTextEditor);

		const isActive = !isDirty && isRunning && active_file_name === file_name;

		if (file_extension === '.json') {
			const leftIcon = isActive ? '$(rocket)' : '$(run)';
			const rightIcon = isDirty ? '$(circle-filled)' : '';
			const runningIcon = isRunning ? '$(arrow-up)' : '$(arrow-down)';

			myStatusBarItem.text = `${leftIcon} ${file_name} ${rightIcon} ${runningIcon}`;
			myStatusBarItem.show();
		} else {
			myStatusBarItem.hide();
		}
	}
}

function getFileExtension(editor: vscode.TextEditor | undefined): string | undefined {
	if (editor) {
		return posix.extname(editor.document.uri.path);
	}
}

function getFileName(editor: vscode.TextEditor | undefined): string | undefined {
	if (editor) {
		return posix.basename(editor.document.uri.path);
	}
}
