const path = require('path');
const CopyPlugin = require('copy-webpack-plugin');

/**
 * @type {import('webpack').Configuration}
 */
module.exports = {
  entry: './src/extension.ts',
  target: 'node',
  mode: 'none',
  output: {
    path: path.resolve(__dirname, 'dist'),
    filename: 'extension.js',
    libraryTarget: 'commonjs2'
  },
  devtool: 'source-map',
  externals: {
    vscode: 'commonjs vscode',
    // Add external packages with binary dependencies
    dockerode: 'commonjs dockerode',
    'cpu-features': 'commonjs cpu-features',
    ssh2: 'commonjs ssh2',
    'docker-modem': 'commonjs docker-modem'
  },
  resolve: {
    extensions: ['.ts', '.js']
  },
  module: {
    rules: [
      {
        test: /\.ts$/,
        exclude: /node_modules/,
        use: [
          {
            loader: 'ts-loader'
          }
        ]
      }
    ]
  },
  plugins: [
    new CopyPlugin({
      patterns: [
        { from: 'media', to: 'media' }
      ]
    })
  ],
  // Ignore warnings about these modules
  ignoreWarnings: [
    {
      module: /cpu-features/
    },
    {
      module: /ssh2/
    }
  ]
}; 